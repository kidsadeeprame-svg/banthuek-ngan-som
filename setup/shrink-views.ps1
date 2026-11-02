<#
  shrink-views.ps1 — ย่อรูป "view" ที่อยู่บน Supabase Storage ให้เล็กลง
  เพื่อคืนพื้นที่ให้อยู่ในโควตา Free 1 GB

  รูป view เดิม 1280px คุณภาพ 75 เฉลี่ย ~330 KB กินพื้นที่ 77% ของทั้งหมด
  ย่อเหลือ 1024px คุณภาพ 60 (~96 KB) ทับที่เดิม — path ไม่เปลี่ยน
  ฐานข้อมูลจึงไม่ต้องแก้อะไร แอปเปิดรูปได้เหมือนเดิม

  ความปลอดภัย
    - ก่อนทับไฟล์ไหน ต้องมีสำเนาในโฟลเดอร์สำรองในเครื่องก่อนเสมอ
      ถ้ายังไม่มี จะดาวน์โหลดเก็บลงเครื่องให้ก่อน แล้วค่อยย่อ
    - ย่อจากไฟล์ในเครื่อง ไม่ต้องดาวน์โหลด 800 MB ซ้ำ
    - ข้ามไฟล์ที่ย่อแล้วไม่เล็กลง และไฟล์ที่เล็กอยู่แล้ว (< 150 KB)
    - จดว่าย่อไฟล์ไหนไปแล้ว รันซ้ำได้ ไม่ย่อซ้ำ

  -Apply   ย่อจริง (ไม่ใส่ = ดูอย่างเดียว)
#>
param([switch]$Apply, [int]$MaxSide = 1024, [int]$Quality = 60)

$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$root = Split-Path $PSScriptRoot -Parent
$cfg  = Get-Content (Join-Path $root 'backup\backup-config.json') -Raw -Encoding utf8 | ConvertFrom-Json
$auth = Invoke-RestMethod -Method Post `
  -Uri "$($cfg.supabaseUrl)/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $cfg.anonKey; 'Content-Type' = 'application/json' } `
  -Body (@{ email = $cfg.email; password = $cfg.pin } | ConvertTo-Json)
$token = $auth.access_token
$H = @{ apikey = $cfg.anonKey; Authorization = "Bearer $token" }
$photoDir = Join-Path $root 'backup\data\photos'
$statePath = Join-Path $root 'backup\data\shrink-state.txt'
$done = New-Object System.Collections.Generic.HashSet[string]
if (Test-Path $statePath) { Get-Content $statePath -Encoding utf8 | ForEach-Object { [void]$done.Add($_) } }

# ─────────── รายชื่อรูป view ที่งานอ้างถึง ───────────
$jobs = @(); $offset = 0
do {
  $res = Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing `
    -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?select=id,photos&order=id.asc&limit=1000&offset=$offset"
  $d = $res.Content | ConvertFrom-Json
  if ($null -eq $d) { $chunk = @() } elseif ($d -is [System.Array]) { $chunk = $d } else { $chunk = @($d) }
  $jobs += $chunk; $offset += 1000
} while ($chunk.Count -eq 1000)

$views = @()
foreach ($j in $jobs) {
  if (-not $j.photos) { continue }
  foreach ($p in $j.photos.PSObject.Properties) {
    if ($p.Value.view) { $views += [pscustomobject]@{ id = $j.id; slot = $p.Name; path = $p.Value.view } }
  }
}
$todo = @($views | Where-Object { -not $done.Contains($_.path) })
Say "รูป view ที่งานอ้างถึง $($views.Count) · ย่อไปแล้ว $($views.Count - $todo.Count) · เหลือ $($todo.Count)" 'Cyan'

# ─────────── ตัวย่อรูป ───────────
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
function Shrink([string]$path) {
  $img = [System.Drawing.Image]::FromFile($path)
  try {
    $s = [Math]::Min(1.0, $MaxSide / [Math]::Max($img.Width, $img.Height))
    $w = [int]($img.Width * $s); $h = [int]($img.Height * $s)
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $codec, $ep); $bmp.Dispose()
    return ,$ms.ToArray()
  } finally { $img.Dispose() }
}

# อัปโหลดไบนารีต้องใช้ HttpClient — Invoke-RestMethod ใน PS 5.1
# แปลง byte[] เป็นข้อความแล้วทำรูปเสียทั้งที่ตอบ 200 (เคยเจอมาแล้ว)
$http = New-Object System.Net.Http.HttpClient
$http.DefaultRequestHeaders.Add('apikey', $cfg.anonKey)
$http.DefaultRequestHeaders.Add('Authorization', "Bearer $token")
$http.DefaultRequestHeaders.Add('x-upsert', 'true')

$before = 0; $after = 0; $n = 0; $skip = 0; $fetched = 0
foreach ($v in $todo) {
  $n++
  $local = Join-Path $photoDir (Join-Path $v.id "$($v.slot).jpg")

  # 1. ต้องมีสำเนาในเครื่องก่อน ไม่มีก็โหลดลงมาเก็บ
  if (-not (Test-Path -LiteralPath $local)) {
    if (-not $Apply) { $fetched++; continue }
    New-Item -ItemType Directory -Force -Path (Split-Path $local) | Out-Null
    Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing `
      -Uri "$($cfg.supabaseUrl)/storage/v1/object/photos/$([uri]::EscapeUriString($v.path))" -OutFile $local | Out-Null
    $fetched++
  }

  $orig = (Get-Item -LiteralPath $local).Length
  if ($orig -lt 150KB) { $skip++; [void]$done.Add($v.path); continue }
  $bytes = Shrink $local
  if ($bytes.Length -ge $orig) { $skip++; [void]$done.Add($v.path); continue }
  $before += $orig; $after += $bytes.Length

  if ($Apply) {
    $content = New-Object System.Net.Http.ByteArrayContent(, $bytes)
    $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('image/jpeg')
    $resp = $http.PostAsync("$($cfg.supabaseUrl)/storage/v1/object/$([uri]::EscapeUriString("photos/$($v.path)"))", $content).Result
    if (-not $resp.IsSuccessStatusCode) {
      Say "  อัปไม่สำเร็จ $($v.path): $($resp.StatusCode) $($resp.Content.ReadAsStringAsync().Result)" 'Yellow'
      continue
    }
    [void]$done.Add($v.path)
    Add-Content $statePath $v.path -Encoding utf8
  }
  if ($n % 100 -eq 0) { Say "  $n/$($todo.Count) · ลดไปแล้ว $([Math]::Round(($before-$after)/1MB)) MB" }
}

Say ''
Say ('ย่อ {0} ไฟล์ · จาก {1} MB เหลือ {2} MB · คืนพื้นที่ {3} MB' -f ($n - $skip - $fetched * [int](-not $Apply)),
  [Math]::Round($before/1MB), [Math]::Round($after/1MB), [Math]::Round(($before-$after)/1MB)) 'Green'
if ($skip)    { Say "ข้าม $skip ไฟล์ (เล็กอยู่แล้ว หรือย่อแล้วไม่เล็กลง)" }
if ($fetched) { Say "ไฟล์ที่ยังไม่มีในเครื่อง $fetched ไฟล์ — $(if ($Apply) {'ดาวน์โหลดเก็บไว้ก่อนย่อแล้ว'} else {'จะดาวน์โหลดเก็บก่อนย่อตอนสั่ง -Apply'})" }
if (-not $Apply) { Say ''; Say 'โหมดดูอย่างเดียว — ใส่ -Apply เพื่อย่อจริง' 'Yellow' }
