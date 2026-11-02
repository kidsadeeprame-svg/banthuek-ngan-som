<#
  storage-audit.ps1 — ตรวจพื้นที่ Storage บน Supabase ว่าอะไรกินที่เท่าไร
  และหาไฟล์กำพร้า (อยู่ใน storage แต่ไม่มีงานไหนอ้างถึง) ที่ลบทิ้งได้

  ไฟล์กำพร้าเกิดจากตอนนำเข้ารอบแรกที่อัปทั้ง view และ thumb
  ก่อนจะเปลี่ยนมาอัปเฉพาะ thumb — ของเก่าจึงค้างอยู่โดยไม่มีใครเรียกใช้

  -Delete   ลบไฟล์กำพร้าจริง (ไม่ใส่ = ดูอย่างเดียว)
#>
param([switch]$Delete)

$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

$root = Split-Path $PSScriptRoot -Parent
$cfg  = Get-Content (Join-Path $root 'backup\backup-config.json') -Raw -Encoding utf8 | ConvertFrom-Json
$auth = Invoke-RestMethod -Method Post `
  -Uri "$($cfg.supabaseUrl)/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $cfg.anonKey; 'Content-Type' = 'application/json' } `
  -Body (@{ email = $cfg.email; password = $cfg.pin } | ConvertTo-Json)
$H  = @{ apikey = $cfg.anonKey; Authorization = "Bearer $($auth.access_token)" }
$HJ = $H + @{ 'Content-Type' = 'application/json' }
Say "ล็อกอินสำเร็จ" 'Green'

# ─────────── 1. ไฟล์ที่ฐานข้อมูลอ้างถึง ───────────
$jobs = @(); $offset = 0; $size = 1000
do {
  $res = Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing `
    -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?select=id,photos,deleted&order=id.asc&limit=$size&offset=$offset"
  $d = $res.Content | ConvertFrom-Json
  if ($null -eq $d) { $chunk = @() } elseif ($d -is [System.Array]) { $chunk = $d } else { $chunk = @($d) }
  $jobs += $chunk; $offset += $size
} while ($chunk.Count -eq $size)

$used = New-Object System.Collections.Generic.HashSet[string]
foreach ($j in $jobs) {
  if (-not $j.photos) { continue }
  foreach ($p in $j.photos.PSObject.Properties) {
    foreach ($k in 'view','thumb') { $v = $p.Value.$k; if ($v) { [void]$used.Add($v) } }
  }
}
Say "ฐานข้อมูล: $($jobs.Count) งาน · อ้างถึงไฟล์รูป $($used.Count) ไฟล์" 'Green'

# ─────────── 2. ไฟล์ที่มีจริงใน storage ───────────
Say 'กำลังไล่อ่านโฟลเดอร์ใน storage…'
$folders = @(); $off = 0
do {
  $pageRaw = Invoke-RestMethod -Method Post -Headers $HJ `
    -Uri "$($cfg.supabaseUrl)/storage/v1/object/list/photos" `
    -Body (@{ prefix=''; limit=1000; offset=$off } | ConvertTo-Json)
  $page = @($pageRaw)
  $folders += @($page | Where-Object { -not $_.id } | ForEach-Object { $_.name })
  $off += 1000
} while ($page.Count -eq 1000)
Say "  พบ $($folders.Count) โฟลเดอร์"

$files = @(); $n = 0
foreach ($f in $folders) {
  $n++
  # พักลงตัวแปรก่อน — ครอบ @() ตรงท่อจะได้ array ซ้อน array (กับดัก PS 5.1)
  $lsRaw = Invoke-RestMethod -Method Post -Headers $HJ `
    -Uri "$($cfg.supabaseUrl)/storage/v1/object/list/photos" `
    -Body (@{ prefix="$f/"; limit=200; offset=0 } | ConvertTo-Json)
  $ls = @($lsRaw)
  foreach ($o in $ls) {
    if (-not $o.id) { continue }
    $files += [pscustomobject]@{ path = "$f/$($o.name)"; size = [int]$o.metadata.size }
  }
  if ($n % 200 -eq 0) { Say "  อ่านแล้ว $n/$($folders.Count) โฟลเดอร์ · $($files.Count) ไฟล์" }
}

$sum = ($files | Measure-Object size -Sum).Sum
Say "  ไฟล์ทั้งหมด $($files.Count) ไฟล์ · $([Math]::Round($sum/1MB)) MB" 'Green'

# ─────────── 3. สรุป ───────────
$view  = @($files | Where-Object { $_.path -like '*.view.jpg' })
$thumb = @($files | Where-Object { $_.path -like '*.thumb.jpg' })
$other = @($files | Where-Object { $_.path -notlike '*.view.jpg' -and $_.path -notlike '*.thumb.jpg' })
$orph  = @($files | Where-Object { -not $used.Contains($_.path) })

function Line($name, $set) {
  $s = ($set | Measure-Object size -Sum).Sum
  '{0,-28} {1,6} ไฟล์  {2,6} MB  (เฉลี่ย {3} KB)' -f $name, $set.Count,
    [Math]::Round($s/1MB), [Math]::Round(($set | Measure-Object size -Average).Average/1KB)
}
Say ''
Say '═══ พื้นที่ที่ใช้อยู่ ═══' 'Cyan'
Say (Line 'รูปดูจริง 1280px (view)' $view)
Say (Line 'รูปย่อ 400px (thumb)'   $thumb)
if ($other.Count) { Say (Line 'อื่น ๆ' $other) }
Say ('{0,-28} {1,6} ไฟล์  {2,6} MB   จากโควตา 1024 MB' -f 'รวม', $files.Count, [Math]::Round($sum/1MB)) 'Yellow'
Say ''
Say '═══ ไฟล์กำพร้า (ไม่มีงานไหนอ้างถึง — ลบได้) ═══' 'Cyan'
Say (Line 'กำพร้าทั้งหมด' $orph) 'Yellow'
$ov = @($orph | Where-Object { $_.path -like '*.view.jpg' })
$ot = @($orph | Where-Object { $_.path -like '*.thumb.jpg' })
if ($ov.Count) { Say ('  - ' + (Line 'เป็น view' $ov)) }
if ($ot.Count) { Say ('  - ' + (Line 'เป็น thumb' $ot)) }
Say ''
Say ('ลบกำพร้าแล้วจะเหลือ {0} MB ({1}% ของโควตา)' -f
  [Math]::Round(($sum - ($orph | Measure-Object size -Sum).Sum)/1MB),
  [Math]::Round(($sum - ($orph | Measure-Object size -Sum).Sum)/1GB*100)) 'Green'

$csv = Join-Path $root 'backup\data\storage-audit.csv'
$files | Export-Csv $csv -NoTypeInformation -Encoding utf8
Say "รายชื่อไฟล์ทั้งหมดเก็บไว้ที่ $csv" 'DarkGray'

if (-not $Delete) { Say ''; Say 'โหมดดูอย่างเดียว — ใส่ -Delete เพื่อลบไฟล์กำพร้าจริง' 'Yellow'; exit 0 }
if (-not $orph.Count) { Say 'ไม่มีไฟล์กำพร้า ไม่ต้องลบอะไร' 'Green'; exit 0 }

# ─────────── 4. ลบ ───────────
$bak = Join-Path $root 'backup\data\orphans-deleted.csv'
$orph | Export-Csv $bak -NoTypeInformation -Encoding utf8
Say "จดรายชื่อที่จะลบไว้ที่ $bak" 'DarkGray'

$gone = 0
for ($i = 0; $i -lt $orph.Count; $i += 100) {
  $slice = $orph[$i..([Math]::Min($i + 99, $orph.Count - 1))]
  $body = @{ prefixes = @($slice | ForEach-Object { $_.path }) } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Delete -Headers $HJ `
    -Uri "$($cfg.supabaseUrl)/storage/v1/object/photos" `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  $gone += $slice.Count
  Say "  ลบแล้ว $gone/$($orph.Count)"
}
Say "ลบไฟล์กำพร้าครบ $gone ไฟล์ · คืนพื้นที่ $([Math]::Round(($orph | Measure-Object size -Sum).Sum/1MB)) MB" 'Green'
