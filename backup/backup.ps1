# ═══════════════════════════════════════════════════════════
#  สำรองข้อมูลจาก Supabase ลงคอมเครื่องนี้
#  - ข้อมูลงานซ่อม  -> CSV (เปิดใน Excel ได้) + JSON (ครบทุกฟิลด์)
#  - รูปภาพ         -> โฟลเดอร์ photos\<เลขงาน>\  (ดาวน์โหลดเฉพาะที่ยังไม่มี)
#
#  ตั้งค่าครั้งแรก: คัดลอก backup-config.example.json เป็น backup-config.json
#                   แล้วใส่ค่าให้ครบ
#  รันเอง:          คลิกขวาที่ไฟล์นี้ -> Run with PowerShell
#  รันอัตโนมัติ:    ดู docs\ติดตั้ง.md หัวข้อ "ตั้งให้สำรองอัตโนมัติ"
# ═══════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $here 'backup-config.json'

if (-not (Test-Path $cfgPath)) {
  Write-Host "ไม่พบไฟล์ backup-config.json" -ForegroundColor Red
  Write-Host "ให้คัดลอก backup-config.example.json เป็น backup-config.json แล้วใส่ค่าก่อน"
  Read-Host "กด Enter เพื่อปิด"; exit 1
}

$cfg     = Get-Content $cfgPath -Raw -Encoding utf8 | ConvertFrom-Json
$outRoot = if ($cfg.outputFolder) { $cfg.outputFolder } else { Join-Path $here 'data' }
$photoDir = Join-Path $outRoot 'photos'
New-Item -ItemType Directory -Force -Path $outRoot, $photoDir | Out-Null

$logFile = Join-Path $outRoot 'backup.log'
function Say([string]$m, [string]$color = 'Gray') {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $line -ForegroundColor $color
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

Say "เริ่มสำรองข้อมูล" 'Cyan'

# ─────────── 1. ล็อกอิน ───────────
try {
  $auth = Invoke-RestMethod -Method Post `
    -Uri "$($cfg.supabaseUrl)/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $cfg.anonKey } -ContentType 'application/json' `
    -Body (@{ email = $cfg.email; password = $cfg.pin } | ConvertTo-Json)
} catch {
  Say "ล็อกอินไม่สำเร็จ: $($_.Exception.Message)" 'Red'
  Say "ตรวจ email / pin / anonKey ใน backup-config.json" 'Yellow'
  exit 1
}
$H = @{ apikey = $cfg.anonKey; Authorization = "Bearer $($auth.access_token)" }
Say "ล็อกอินสำเร็จ ($($cfg.email))" 'Green'

# ─────────── 2. ดึงข้อมูลงานซ่อม ───────────
# แบ่งหน้าด้วย limit/offset ของ PostgREST ไม่ใช้ HTTP header Range
# เพราะ PowerShell 5.1 ห้ามตั้ง Range ผ่าน -Headers (โยน error ทันที)
$jobs = @()
$size = 1000
$offset = 0
do {
  $chunk = @(Invoke-RestMethod -Method Get -Headers $H `
    -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?select=*&order=id.asc&limit=$size&offset=$offset")
  $jobs += $chunk
  $offset += $size
} while ($chunk.Count -eq $size)

Say "ดึงข้อมูลได้ $($jobs.Count) รายการ" 'Green'
if ($jobs.Count -eq 0) { Say "ไม่มีข้อมูล — จบการทำงาน" 'Yellow'; exit 0 }

# ─────────── 3. เขียน JSON + CSV ───────────
$stamp = Get-Date -Format 'yyyy-MM-dd'
$jobs | ConvertTo-Json -Depth 6 |
  Set-Content (Join-Path $outRoot 'jobs.json') -Encoding utf8

function ToThaiDate([string]$iso) {
  if ([string]::IsNullOrWhiteSpace($iso)) { return '' }
  $d = [datetime]::Parse($iso.Substring(0,10))
  return '{0:D2}/{1:D2}/{2}' -f $d.Day, $d.Month, ($d.Year + 543)
}

$csv = $jobs | ForEach-Object {
  [pscustomobject][ordered]@{
    'ลำดับงานซ่อม'          = $_.id
    'วันที่รับงาน'           = ToThaiDate $_.date_in
    'วันที่ปิดงาน'           = ToThaiDate $_.date_out
    'สถานะ'                 = $_.status
    'เลขที่ใบส่งซ่อม'        = $_.doc_no
    'สาขา'                  = $_.branch
    'ประเภทสินค้า'          = $_.product_type
    'ลวดลาย'                = $_.pattern
    'Part'                  = $_.part
    'อาการชำรุด-ลักษณะ'     = $_.defect_kind
    'อาการชำรุด-ตำแหน่ง'    = $_.defect_spot
    'น้ำหนักรับซ่อม'         = $_.weight_in
    'น้ำหนักส่ง'             = $_.weight_out
    'นน.เติม'               = $_.weight_add
    'ส่วนต่างน้ำหนัก'        = $_.weight_loss
    'วิธีซ่อม'               = $_.method
    'ช่างผู้ซ่อม'            = $_.technician
    'ผู้บันทึก'              = $_.recorded_by
    'หมายเหตุ'              = $_.notes
  }
}
# UTF8 พร้อม BOM เพื่อให้ Excel อ่านภาษาไทยถูก
$csvPath = Join-Path $outRoot "บันทึกงานซ่อม_$stamp.csv"
$csv | ConvertTo-Csv -NoTypeInformation |
  Out-File -FilePath $csvPath -Encoding utf8
Say "เขียน CSV: $csvPath" 'Green'

# ─────────── 4. ดาวน์โหลดรูปที่ยังไม่มีในเครื่อง ───────────
$new = 0; $skip = 0; $fail = 0
foreach ($j in $jobs) {
  if (-not $j.photos) { continue }
  $jobFolder = Join-Path $photoDir $j.id
  foreach ($slot in $j.photos.PSObject.Properties) {
    $p = $slot.Value
    if (-not $p.view) { continue }              # missing / ไม่มีรูป
    $dest = Join-Path $jobFolder ("{0}.jpg" -f $slot.Name)
    if (Test-Path $dest) { $skip++; continue }
    New-Item -ItemType Directory -Force -Path $jobFolder | Out-Null
    try {
      $enc = [uri]::EscapeUriString($p.view)
      Invoke-WebRequest -Method Get -Headers $H `
        -Uri "$($cfg.supabaseUrl)/storage/v1/object/photos/$enc" `
        -OutFile $dest | Out-Null
      $new++
    } catch {
      $fail++
      Say "  โหลดรูปไม่สำเร็จ $($j.id)/$($slot.Name): $($_.Exception.Message)" 'Yellow'
    }
  }
}
Say "รูป: ใหม่ $new · มีอยู่แล้ว $skip · ล้มเหลว $fail" 'Green'

# ─────────── 5. เก็บ CSV ย้อนหลังไม่เกิน 30 ไฟล์ ───────────
Get-ChildItem $outRoot -Filter 'บันทึกงานซ่อม_*.csv' |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 |
  Remove-Item -Force -ErrorAction SilentlyContinue

Say "สำรองข้อมูลเสร็จสมบูรณ์ -> $outRoot" 'Cyan'
