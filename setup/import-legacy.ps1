# ═══════════════════════════════════════════════════════════
#  นำเข้าข้อมูลเก่าจาก Google Sheet "บันทึกงานซ่อม" เข้า Supabase
#
#  ทำไมใช้ PowerShell ไม่ใช่เบราว์เซอร์:
#    1,381 แถว + 6,583 รูป ผ่านเบราว์เซอร์ต้องเปิดหน้าค้าง 1-2 ชม.
#    หลุดกลางคันต้องเริ่มใหม่ สคริปต์นี้หยุดแล้วรันต่อได้
#
#  วิธีใช้ (ต้องมี backup\backup-config.json ตั้งค่าไว้แล้ว):
#    .\import-legacy.ps1 -Preview             ดูผลการล้างข้อมูลก่อน ไม่เขียนอะไร
#    .\import-legacy.ps1 -DataOnly            นำเข้าเฉพาะข้อมูล 1,381 แถว
#    .\import-legacy.ps1 -ImageFolder "D:\รูปงานซ่อม"   นำเข้ารูปด้วย
# ═══════════════════════════════════════════════════════════

param(
  [switch]$Preview,
  [switch]$DataOnly,
  [string]$ImageFolder = '',
  [string]$SheetId = '1rEJXtt6LxfAQQvIV3hDQIND8rZ0lDmnKoxiktgBoyNE'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$root    = Split-Path -Parent $here
$cfgPath = Join-Path $root 'backup\backup-config.json'
$workDir = Join-Path $root 'backup\data'
$photoDir = Join-Path $workDir 'photos'
$statePath = Join-Path $workDir 'import-state.json'

function Say([string]$m, [string]$c = 'Gray') {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ForegroundColor $c
}

# ─────────── 1. ตั้งค่า + ล็อกอิน ───────────
if (-not (Test-Path $cfgPath)) { Say "ไม่พบ backup-config.json" 'Red'; exit 1 }
$cfg = Get-Content $cfgPath -Raw -Encoding utf8 | ConvertFrom-Json

$H = $null
if (-not $Preview) {
  try {
    $auth = Invoke-RestMethod -Method Post `
      -Uri "$($cfg.supabaseUrl)/auth/v1/token?grant_type=password" `
      -Headers @{ apikey = $cfg.anonKey } -ContentType 'application/json' `
      -Body (@{ email = $cfg.email; password = $cfg.pin } | ConvertTo-Json)
  } catch { Say "ล็อกอินไม่สำเร็จ: $($_.Exception.Message)" 'Red'; exit 1 }
  $H = @{ apikey = $cfg.anonKey; Authorization = "Bearer $($auth.access_token)" }
  Say "ล็อกอินสำเร็จ ($($cfg.email))" 'Green'
}

# ─────────── 2. ดึงชีทสด ๆ ───────────
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$csvPath = Join-Path $workDir 'sheet-source.csv'
Say "ดาวน์โหลดชีทจาก Google…"
Invoke-WebRequest -Uri "https://docs.google.com/spreadsheets/d/$SheetId/export?format=csv&gid=0" `
  -OutFile $csvPath -TimeoutSec 180 -UseBasicParsing
$src = Import-Csv $csvPath -Encoding UTF8
Say "ได้ $($src.Count) แถว" 'Green'

# ═══════════════════════════════════════════════════════════
#  3. กฎการล้างข้อมูล
# ═══════════════════════════════════════════════════════════

function Norm([string]$s) {
  if ($null -eq $s) { return '' }
  $s = ($s -replace '\s+', ' ').Trim()
  if ($s -eq '-' -or $s -eq '_') { return '' }
  # เขียน "สองสี" กับ "2สี" ให้เป็นรูปแบบเดียว
  $s = $s -replace 'สองสี', '2 สี' -replace '(\d)\s*สี', '$1 สี'
  return ($s -replace '\s+', ' ').Trim()
}

# คำสะกดผิดที่ยืนยันได้ว่าหมายถึงลายเดียวกัน
$patternFix = @{
  'ท่าโร่'='ทาโร่'; 'ทาโร'='ทาโร่'
  'สี่เสส'='สี่เสา'; 'สี้เสา'='สี่เสา'
  'สามหว่ง'='สามห่วง'; 'สามหวง'='สามห่วง'
  'คตกิน'='คตกิต'; 'คตดกิต'='คตกิต'; 'คดกิต'='คตกิต'
  'เกล๊ดดาว'='เกล็ดดาว'; 'เกลดดาว'='เกล็ดดาว'
  'กำไฃ'='กำไล'; 'กำใล'='กำไล'
  'ยีนตัน 2 สี'='ยินตัน 2 สี'; 'ยินตัน 2 สี'='ยินตัน 2 สี'
  'ก้นหอยสองสี'='ก้นหอย 2 สี'
  'ผ่าหวายทรางเครื่อง'='ผ่าหวายทรงเครื่อง'
  'ทองคำขาว'='ทองทำขาว 2 สี'
  'ขาดระหว่างเส้น'=''      # ข้อมูลหลุดช่อง ไม่ใช่ลวดลาย
}

# วิธีซ่อม: รวมด้วยคำสำคัญ "ไฟ" กับ "เลเซอร์" คือแกนหลักของงาน 85%
function FixMethod([string]$s) {
  $s = Norm $s
  if ($s -eq '') { return '' }
  $fire  = $s -match 'ไฟ'
  $laser = $s -match 'เลเซอร์|เลเซอ|เซอร์'
  if ($fire -and $laser) { return 'เชื่อมเลเซอร์ + เชื่อมไฟ' }
  if ($laser) { return 'เชื่อมเลเซอร์' }
  if ($fire)  { return 'เชื่อมไฟ' }
  switch -Regex ($s) {
    '^ไม่ซ่อม'      { return 'ไม่ซ่อม' }
    'ผลิตใหม่'      { return 'ผลิตใหม่' }
    '^หลอม|ทดลองหลอม' { return 'หลอม' }
    default         { return $s }
  }
}

# อาการชำรุด: แยกเป็น ลักษณะ × ตำแหน่ง
$defectKinds = @(
  @{k='ล็อคไม่แน่น'; p=@('ล็อคไม่แน่น','ล็อกไม่แน่น','ล็อคหลวม')},
  @{k='แตกลาย';      p=@('แตกลาย','แตก')},
  @{k='ด่าง';        p=@('ด่าง')},
  @{k='หลุด';        p=@('หลุด')},
  @{k='บุบ';         p=@('บุบ')},
  @{k='หัก';         p=@('หัก')},
  @{k='ขาด';         p=@('ขาด')},
  @{k='ดีด';         p=@('ดีด')}
)
$defectSpots = @(
  @{s='ระหว่างเส้น'; p=@('ระหว่างเส้น')},
  @{s='ใกล้หัวจรวด'; p=@('ใกล้หัวจรวด','บริเวณหัวจรวด','หัวจรวด')},
  @{s='ใกล้ห่วง';    p=@('ใกล้ห่วง','ห่วง')},
  @{s='ตะขอ';        p=@('ตะขอ','ก้ามปู')},
  @{s='ทั้งเส้น';    p=@('ทั้งเส้น')}
)
function SplitDefect([string]$t) {
  $t = Norm $t
  if ($t -eq '') { return @{ kind=''; spot=''; note='' } }
  $kind=''; $spot=''
  foreach ($d in $defectKinds) { foreach ($p in $d.p) { if ($t -like "*$p*") { $kind=$d.k; break } }; if ($kind) { break } }
  foreach ($d in $defectSpots) { foreach ($p in $d.p) { if ($t -like "*$p*") { $spot=$d.s; break } }; if ($spot) { break } }
  if (-not $kind) { return @{ kind='อื่น ๆ'; spot=$spot; note=$t } }
  return @{ kind=$kind; spot=$spot; note='' }
}

function ToIso([string]$d) {
  if ($d -match '^(\d{1,2})/(\d{1,2})/(\d{4})$') {
    $day=[int]$Matches[1]; $mon=[int]$Matches[2]; $yr=[int]$Matches[3]
    if ($yr -gt 2400) { $yr -= 543 }
    try { return (Get-Date -Year $yr -Month $mon -Day $day).ToString('yyyy-MM-dd') } catch { return $null }
  }
  return $null
}
function ImgName([string]$v) {
  if ($v -match '_Images/(.+)$') { return $Matches[1] }
  return ''
}
function ToNum([string]$v) {
  $v = ($v -replace '[^\d\.\-]', '')
  if ($v -match '^-?\d+(\.\d+)?$') { return [double]$v }
  return $null
}

# ═══════════════════════════════════════════════════════════
#  4. แปลงทุกแถว
# ═══════════════════════════════════════════════════════════
$imgCols = @{ imgDoc='ภาพถ่ายใบซ่อม'; imgDefect='ภาพชำรุด'; imgWeightIn='ภาพรับ'; imgWeightOut='ภาพส่ง'; imgDone='ภาพแก้ไข' }
$jobs = @(); $skipped = 0

foreach ($r in $src) {
  $id = ($r.'ลำดับงานซ่อม').Trim()
  if ($id -notmatch '^F\d+$') { $skipped++; continue }
  if ($r.'เลขที่ใบส่งซ่อม' -match '^Test') { $skipped++; continue }

  $pattern = Norm $r.'ลวดลาย'
  if ($patternFix.ContainsKey($pattern)) { $pattern = $patternFix[$pattern] }

  $method = FixMethod $r.'วิธีซ่อม'
  if ($method -match '_Images/') { $method = '' }

  $def = SplitDefect $r.'อาการชำรุด'
  $notes = Norm $r.'หมายเหตุ'
  if ($def.note) { $notes = (@($def.note, $notes) | Where-Object { $_ }) -join ' / ' }

  $doc = Norm $r.'เลขที่ใบส่งซ่อม'
  $branch = ''
  if ($doc -match '^([A-Za-z0-9]{5})-') { $branch = $Matches[1] }

  $status = switch (($r.'สถานะ').Trim()) {
    'Done'     { 'เสร็จสิ้น' }
    'Reject'   { 'ไม่ซ่อม' }
    'Open job' { 'รับงาน' }
    default    { 'รับงาน' }
  }
  $dateIn = ToIso $r.'วันที่รับงาน'

  $imgs = @{}
  foreach ($k in $imgCols.Keys) {
    $n = ImgName $r.($imgCols[$k])
    if ($n) { $imgs[$k] = $n }
  }

  $jobs += [pscustomobject]@{
    id          = $id
    date_in     = $dateIn
    # ชีทเดิมไม่มีวันที่ปิดงาน — ปล่อยว่างไว้
    # ห้ามใส่ date_in แทน ไม่งั้นงานเก่าจะดูเหมือนเสร็จภายในวันเดียวทุกชิ้น
    date_out    = $null
    status      = $status
    doc_no      = $doc
    branch      = $branch
    product_type= Norm $r.'ประเภทสินค้า'
    pattern     = $pattern
    part        = Norm $r.'Part'
    defect_kind = $def.kind
    defect_spot = $def.spot
    weight_in   = ToNum $r.'น้ำหนักรับซ่อม'
    weight_out  = ToNum $r.'น้ำหนักส่ง'
    weight_add  = ToNum $r.'นน.เติม'
    method      = $method
    technician  = ''
    recorded_by = '(นำเข้าจากชีท)'
    notes       = $notes
    legacy      = $true
    deleted     = $false
    _imgs       = $imgs
  }
}
Say "แปลงได้ $($jobs.Count) แถว (ข้าม $skipped แถวทดสอบ/ไม่มีรหัส)" 'Green'

# ─────────── 5. สร้างรายการตัวเลือก แยกใช้งาน/ปิดใช้ ───────────
function BuildList($values, $baseline) {
  $g = $values | Where-Object { $_ } | Group-Object | Sort-Object Count -Descending
  $active   = @($g | Where-Object { $_.Count -ge 3 } | ForEach-Object { $_.Name })
  $rare     = @($g | Where-Object { $_.Count -lt 3 } | ForEach-Object { $_.Name })
  $all      = @($baseline + $active + $rare | Where-Object { $_ } | Select-Object -Unique | Sort-Object)
  $disabled = @($rare | Where-Object { $baseline -notcontains $_ })
  return @{ values = $all; disabled = $disabled; activeCount = ($all.Count - $disabled.Count) }
}

$L = @{
  productTypes = BuildList ($jobs.product_type) @('MOD-96.50%','DDD-75.00%')
  patterns     = BuildList ($jobs.pattern)      @()
  parts        = BuildList ($jobs.part)         @()
  defectKinds  = BuildList ($jobs.defect_kind)  @('ขาด','ดีด','หัก','บุบ','หลุด','แตกลาย','ล็อคไม่แน่น','ด่าง','อื่น ๆ')
  defectSpots  = BuildList ($jobs.defect_spot)  @('ระหว่างเส้น','ใกล้หัวจรวด','ใกล้ห่วง','ตะขอ','ทั้งเส้น')
  methods      = BuildList ($jobs.method)       @('เชื่อมไฟ','เชื่อมเลเซอร์','เชื่อมเลเซอร์ + เชื่อมไฟ','หลอม','ผลิตใหม่','ไม่ซ่อม')
}

Say "รายการตัวเลือกหลังล้าง:" 'Cyan'
foreach ($k in $L.Keys) { "    {0,-13} ทั้งหมด {1,4}  เลือกได้ {2,3}  ปิดใช้ {3,4}" -f $k, $L[$k].values.Count, $L[$k].activeCount, $L[$k].disabled.Count }

if ($Preview) {
  ""; Say "โหมดดูผลอย่างเดียว — ไม่ได้เขียนอะไรลงฐานข้อมูล" 'Yellow'
  "--- วิธีซ่อมหลังรวม ---"
  $jobs | Group-Object method | Sort-Object Count -Desc | Select-Object -First 10 | ForEach-Object { "    {0,5}  {1}" -f $_.Count, $_.Name }
  "--- อาการชำรุดหลังแยก ---"
  $jobs | Group-Object defect_kind | Sort-Object Count -Desc | ForEach-Object { "    {0,5}  {1}" -f $_.Count, $_.Name }
  "--- สถานะ ---"
  $jobs | Group-Object status | ForEach-Object { "    {0,5}  {1}" -f $_.Count, $_.Name }
  exit 0
}

# ═══════════════════════════════════════════════════════════
#  6. ส่งข้อมูลขึ้น Supabase
# ═══════════════════════════════════════════════════════════
$state = if (Test-Path $statePath) { Get-Content $statePath -Raw -Encoding utf8 | ConvertFrom-Json } else { $null }
$done  = New-Object System.Collections.Generic.HashSet[string]
if ($state -and $state.photoDone) { foreach ($x in $state.photoDone) { [void]$done.Add($x) } }

$batch = 100
for ($i = 0; $i -lt $jobs.Count; $i += $batch) {
  $slice = $jobs[$i..([Math]::Min($i + $batch - 1, $jobs.Count - 1))] |
    Select-Object * -ExcludeProperty _imgs
  $body = ConvertTo-Json @($slice) -Depth 5 -Compress
  Invoke-RestMethod -Method Post -Uri "$($cfg.supabaseUrl)/rest/v1/jobs" `
    -Headers ($H + @{ 'Content-Type'='application/json'; Prefer='resolution=merge-duplicates,return=minimal' }) `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  Say "ส่งแล้ว $([Math]::Min($i+$batch,$jobs.Count))/$($jobs.Count)"
}
Say "นำเข้าข้อมูลครบ $($jobs.Count) แถว" 'Green'

# ─────────── รายการตัวเลือก (รวมกับของเดิม ไม่เขียนทับ) ───────────
$existing = @{}
try {
  $res = Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing -Uri "$($cfg.supabaseUrl)/rest/v1/lists?select=*"
  $d = $res.Content | ConvertFrom-Json
  foreach ($row in @($d)) { $existing[$row.name] = $row }
} catch { Say "อ่านรายการเดิมไม่ได้ จะสร้างใหม่" 'Yellow' }

$listRows = @()
foreach ($k in $L.Keys) {
  $oldV = @(); $oldD = @()
  if ($existing.ContainsKey($k)) { $oldV = @($existing[$k].values); $oldD = @($existing[$k].disabled) }
  $listRows += [pscustomobject]@{
    name     = $k
    values   = @(($oldV + $L[$k].values) | Where-Object { $_ } | Select-Object -Unique | Sort-Object)
    disabled = @(($oldD + $L[$k].disabled) | Where-Object { $_ } | Select-Object -Unique)
  }
}
$body = ConvertTo-Json @($listRows) -Depth 5 -Compress
Invoke-RestMethod -Method Post -Uri "$($cfg.supabaseUrl)/rest/v1/lists" `
  -Headers ($H + @{ 'Content-Type'='application/json'; Prefer='resolution=merge-duplicates,return=minimal' }) `
  -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
Say "อัปเดตรายการตัวเลือกแล้ว" 'Green'

if ($DataOnly -or -not $ImageFolder) {
  Say "จบขั้นข้อมูล — รูปยังไม่ได้นำเข้า (ใส่ -ImageFolder เพื่อทำต่อ)" 'Yellow'
  exit 0
}

# ═══════════════════════════════════════════════════════════
#  7. รูปภาพ — ไฟล์เต็มลงเครื่อง + รูปย่อขึ้น cloud
# ═══════════════════════════════════════════════════════════
if (-not (Test-Path $ImageFolder)) { Say "ไม่พบโฟลเดอร์รูป: $ImageFolder" 'Red'; exit 1 }
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

# ต้องใช้ HttpClient ส่งรูป ห้ามใช้ Invoke-WebRequest/-RestMethod กับ -Body ที่เป็น byte[]
# PowerShell 5.1 จะแปลงไบต์ที่ไม่ใช่ตัวอักษรเป็น U+FFFD ทีละ 3 ไบต์
# ไฟล์พองจาก 41 KB เป็น 145 KB และเปิดไม่ได้เลย (ทดสอบยืนยันแล้ว)
$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromSeconds(120)
$http.DefaultRequestHeaders.Add('apikey', $cfg.anonKey)
$http.DefaultRequestHeaders.Add('Authorization', "Bearer $($auth.access_token)")
$http.DefaultRequestHeaders.Add('x-upsert', 'true')

Say "อ่านรายชื่อไฟล์รูป…"
$fileMap = @{}
Get-ChildItem $ImageFolder -Recurse -File -Include *.jpg,*.jpeg,*.png | ForEach-Object { $fileMap[$_.Name] = $_.FullName }
Say "พบไฟล์ $($fileMap.Count) ไฟล์" 'Green'

function MakeThumb([string]$srcFile, [int]$maxSide) {
  $img = [System.Drawing.Image]::FromFile($srcFile)
  try {
    $sc = [Math]::Min(1.0, $maxSide / [Math]::Max($img.Width, $img.Height))
    $w = [int][Math]::Round($img.Width * $sc); $h = [int][Math]::Round($img.Height * $sc)
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose()
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $prm = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $prm.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 70)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $enc, $prm)
    $bmp.Dispose()
    return $ms.ToArray()
  } finally { $img.Dispose() }
}

$nUp = 0; $nCopy = 0; $nMiss = 0; $nSkip = 0; $idx = 0
foreach ($j in $jobs) {
  $idx++
  if ($done.Contains($j.id)) { $nSkip++; continue }
  if ($j._imgs.Count -eq 0) { [void]$done.Add($j.id); continue }

  $photos = @{}
  foreach ($slot in $j._imgs.Keys) {
    $fname = $j._imgs[$slot]
    if (-not $fileMap.ContainsKey($fname)) { $photos[$slot] = @{ missing = $fname }; $nMiss++; continue }
    $full = $fileMap[$fname]

    # ไฟล์เต็ม -> เก็บลงเครื่อง
    $destDir = Join-Path $photoDir $j.id
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $dest = Join-Path $destDir "$slot.jpg"
    if (-not (Test-Path $dest)) { Copy-Item $full $dest; $nCopy++ }

    # รูปย่อ -> ขึ้น cloud
    $path = "$($j.id)/$slot.thumb.jpg"
    try {
      $bytes = MakeThumb $full 400
      $content = New-Object System.Net.Http.ByteArrayContent(, $bytes)
      $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('image/jpeg')
      $resp = $http.PostAsync(
        "$($cfg.supabaseUrl)/storage/v1/object/$([uri]::EscapeUriString("photos/$path"))", $content).Result
      $content.Dispose()
      if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode)" }
      $resp.Dispose()
      $photos[$slot] = @{ thumb = $path }
      $nUp++
    } catch {
      Say "  อัปไม่สำเร็จ $($j.id)/$slot : $($_.Exception.Message)" 'Yellow'
      $photos[$slot] = @{ missing = $fname }
    }
  }

  $body = ConvertTo-Json @{ photos = $photos } -Depth 5 -Compress
  Invoke-RestMethod -Method Patch -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?id=eq.$($j.id)" `
    -Headers ($H + @{ 'Content-Type'='application/json'; Prefer='return=minimal' }) `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null

  [void]$done.Add($j.id)
  if ($idx % 25 -eq 0) {
    @{ photoDone = @($done) } | ConvertTo-Json -Depth 3 | Out-File $statePath -Encoding utf8
    Say "รูป $idx/$($jobs.Count) — อัป $nUp · คัดลอก $nCopy · หาไม่เจอ $nMiss"
  }
}
@{ photoDone = @($done) } | ConvertTo-Json -Depth 3 | Out-File $statePath -Encoding utf8
Say "เสร็จ — อัปรูปย่อ $nUp · คัดลอกไฟล์เต็ม $nCopy · หาไม่เจอ $nMiss · ข้ามที่ทำแล้ว $nSkip" 'Cyan'
