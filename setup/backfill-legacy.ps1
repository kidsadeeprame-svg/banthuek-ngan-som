<#
  backfill-legacy.ps1 — เติมข้อมูลที่ชีทเดิมไม่มี ให้งานที่นำเข้ามา

  ชีทเดิมไม่ได้บันทึก "วันที่ปิดงาน" กับ "ช่างผู้ซ่อม" ไว้
  ตอนนำเข้าจึงปล่อยว่างไว้ ไม่เดาแทน  สคริปต์นี้เติมตามที่สั่ง:
    1. งานที่เสร็จแล้ว  วันที่ปิดงาน = วันที่รับงาน
    2. งานที่เสร็จแล้ว  ช่างผู้ซ่อม  = ช่างโต๊ด

  แตะเฉพาะแถวที่
    - status = 'เสร็จสิ้น'
    - legacy = true        (มาจากชีทเท่านั้น ไม่ยุ่งกับงานที่ลงในแอป)
    - deleted = false
    - ช่องนั้นยังว่างอยู่จริง   (ไม่เขียนทับของที่กรอกไว้แล้ว)

  -Preview  ดูผลอย่างเดียว ไม่เขียนอะไร
#>
param(
  [switch]$Preview,
  [string]$Technician = 'ช่างโต๊ด'
)

$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

$root = Split-Path $PSScriptRoot -Parent
$cfg  = Get-Content (Join-Path $root 'backup\backup-config.json') -Raw -Encoding utf8 | ConvertFrom-Json

$auth = Invoke-RestMethod -Method Post `
  -Uri "$($cfg.supabaseUrl)/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $cfg.anonKey; 'Content-Type' = 'application/json' } `
  -Body (@{ email = $cfg.email; password = $cfg.pin } | ConvertTo-Json)
$H = @{ apikey = $cfg.anonKey; Authorization = "Bearer $($auth.access_token)" }
Say "ล็อกอินสำเร็จ ($($cfg.email))" 'Green'

# ─────────── อ่านงานทั้งหมด (ทีละ 1000 — Supabase คืนได้สูงสุดเท่านี้) ───────────
$jobs = @(); $offset = 0; $size = 1000
do {
  $res = Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing `
    -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?select=id,status,date_in,date_out,technician,legacy,deleted&order=id.asc&limit=$size&offset=$offset"
  # ต้องพักลงตัวแปรก่อน ConvertFrom-Json ใน PS 5.1 ส่ง array ทั้งก้อนเป็นชิ้นเดียว
  $d = $res.Content | ConvertFrom-Json
  if     ($null -eq $d)          { $chunk = @() }
  elseif ($d -is [System.Array]) { $chunk = $d }
  else                           { $chunk = @($d) }
  $jobs += $chunk; $offset += $size
} while ($chunk.Count -eq $size)
Say "อ่านงานได้ $($jobs.Count) ใบ" 'Green'

$target = @($jobs | Where-Object {
  -not $_.deleted -and $_.legacy -and $_.status -eq 'เสร็จสิ้น' })

$needDate = @($target | Where-Object { -not $_.date_out -and $_.date_in })
$noDateIn = @($target | Where-Object { -not $_.date_out -and -not $_.date_in })
$needTech = @($target | Where-Object { -not $_.technician })

Say ''
Say "งานเสร็จสิ้นที่มาจากชีท : $($target.Count)" 'Cyan'
Say "  จะเติมวันที่ปิดงาน     : $($needDate.Count)   (มีอยู่แล้ว $($target.Count - $needDate.Count - $noDateIn.Count) · ไม่มีวันที่รับงาน $($noDateIn.Count))"
Say "  จะเติมช่างเป็น '$Technician' : $($needTech.Count)   (มีอยู่แล้ว $($target.Count - $needTech.Count))"
Say ''

if ($needDate.Count) {
  Say "ตัวอย่างวันที่ปิดงานที่จะเติม:" 'DarkGray'
  $needDate | Select-Object -First 3 | ForEach-Object { "    {0}  รับ {1}  ->  ปิด {1}" -f $_.id, $_.date_in }
}

if ($Preview) { Say ''; Say 'โหมดดูผลอย่างเดียว — ยังไม่ได้เขียนอะไร' 'Yellow'; exit 0 }

$PH = $H + @{ 'Content-Type' = 'application/json'; Prefer = 'return=minimal' }

# ─────────── 1. วันที่ปิดงาน = วันที่รับงาน ───────────
# ค่าต่างกันทีละแถว จึงยิงทีละกลุ่มวันที่ (แถวที่รับงานวันเดียวกันปิดวันเดียวกัน)
$groups = $needDate | Group-Object date_in
$done = 0
foreach ($g in $groups) {
  $ids = @($g.Group | ForEach-Object { $_.id })
  for ($i = 0; $i -lt $ids.Count; $i += 100) {
    $slice = $ids[$i..([Math]::Min($i + 99, $ids.Count - 1))]
    $list  = ($slice -join ',')
    $body  = @{ date_out = $g.Name } | ConvertTo-Json -Compress
    # date_out=is.null ซ้ำอีกชั้น กันเขียนทับของที่เพิ่งมีคนกรอกระหว่างสคริปต์ทำงาน
    Invoke-RestMethod -Method Patch -Headers $PH `
      -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?id=in.($list)&date_out=is.null" `
      -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
    $done += $slice.Count
  }
  if ($groups.IndexOf($g) % 25 -eq 0) { Say "  เติมวันที่ปิดงานแล้ว $done/$($needDate.Count)" }
}
Say "เติมวันที่ปิดงานครบ $done แถว" 'Green'

# ─────────── 2. ช่างผู้ซ่อม ───────────
# ค่าเดียวกันทุกแถว จึงยิงคำสั่งเดียวโดยกรองที่ฐานข้อมูลเลย
if ($needTech.Count) {
  $body = @{ technician = $Technician } | ConvertTo-Json -Compress
  $q = 'status=eq.' + [uri]::EscapeDataString('เสร็จสิ้น') +
       '&legacy=is.true&deleted=is.false&technician=eq.'
  Invoke-RestMethod -Method Patch -Headers $PH `
    -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?$q" `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  Say "ตั้งช่างเป็น '$Technician' ให้ $($needTech.Count) แถว" 'Green'
}

# ─────────── เพิ่มชื่อช่างเข้ารายการตัวเลือก ถ้ายังไม่มี ───────────
$res = Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing -Uri "$($cfg.supabaseUrl)/rest/v1/lists?name=eq.technicians&select=*"
$d = $res.Content | ConvertFrom-Json
$row = @($d)[0]
if ($row -and @($row.values) -notcontains $Technician) {
  $vals = @(@($row.values) + $Technician | Where-Object { $_ } | Select-Object -Unique | Sort-Object)
  $body = ConvertTo-Json @(@{ name = 'technicians'; values = $vals; disabled = @($row.disabled) }) -Depth 5 -Compress
  Invoke-RestMethod -Method Post -Uri "$($cfg.supabaseUrl)/rest/v1/lists" `
    -Headers ($H + @{ 'Content-Type'='application/json'; Prefer='resolution=merge-duplicates,return=minimal' }) `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  Say "เพิ่ม '$Technician' เข้ารายการช่างแล้ว" 'Green'
}

Say ''
Say 'เสร็จเรียบร้อย' 'Green'
