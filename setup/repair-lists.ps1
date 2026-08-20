<#
  repair-lists.ps1 — สร้างรายการตัวเลือก (ลวดลาย / Part / วิธีซ่อม ฯลฯ) ขึ้นใหม่
  จากข้อมูลงานจริงบน Supabase

  ใช้เมื่อรายการตัวเลือกถูกเขียนทับหาย
  ข้อมูลงานทั้ง 1,382 ใบยังอยู่ครบ ทุกใบมีลวดลาย/Part/วิธีซ่อมของตัวเอง
  จึงสร้างรายการกลับมาได้ตรงกับตอนนำเข้าครั้งแรก

  กฎเดียวกับ import-legacy.ps1 เป๊ะ:
    ค่าที่ใช้ตั้งแต่ 3 ครั้งขึ้นไป = เลือกได้
    ค่าที่ใช้น้อยกว่า 3 ครั้ง     = ยังอยู่ในรายการแต่ปิดใช้ (กันพิมพ์ผิดโผล่มากวน)

  -Preview  ดูผลอย่างเดียว ไม่เขียนอะไร
#>
param([switch]$Preview)

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

# ─────────── ดึงงานทั้งหมด (ทีละ 1000 — Supabase คืนได้สูงสุดเท่านี้) ───────────
$jobs = @(); $offset = 0; $size = 1000
do {
  $res = Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing `
    -Uri "$($cfg.supabaseUrl)/rest/v1/jobs?select=pattern,part,method,defect_kind,defect_spot,product_type,category,technician,deleted&order=id.asc&limit=$size&offset=$offset"
  $d = $res.Content | ConvertFrom-Json
  if     ($null -eq $d)          { $chunk = @() }
  elseif ($d -is [System.Array]) { $chunk = $d }
  else                           { $chunk = @($d) }
  $jobs += $chunk
  $offset += $size
} while ($chunk.Count -eq $size)

$jobs = @($jobs | Where-Object { -not $_.deleted })
Say "อ่านงานได้ $($jobs.Count) ใบ" 'Green'
if ($jobs.Count -eq 0) { Say 'ไม่มีข้อมูลงาน — หยุด' 'Red'; exit 1 }

# ─────────── กฎเดียวกับตอนนำเข้า ───────────
function BuildList($values, $baseline) {
  $g        = $values | Where-Object { $_ } | Group-Object | Sort-Object Count -Descending
  $active   = @($g | Where-Object { $_.Count -ge 3 } | ForEach-Object { $_.Name })
  $rare     = @($g | Where-Object { $_.Count -lt 3 } | ForEach-Object { $_.Name })
  $all      = @($baseline + $active + $rare | Where-Object { $_ } | Select-Object -Unique | Sort-Object)
  $disabled = @($rare | Where-Object { $baseline -notcontains $_ })
  return @{ values = $all; disabled = $disabled }
}

$L = @{
  productTypes = BuildList ($jobs.product_type) @('MOD-96.50%','DDD-75.00%')
  categories   = BuildList ($jobs.category)     @('สร้อยคอ','สร้อยข้อมือ')
  patterns     = BuildList ($jobs.pattern)      @()
  parts        = BuildList ($jobs.part)         @()
  defectKinds  = BuildList ($jobs.defect_kind)  @('ขาด','ดีด','หัก','บุบ','หลุด','แตกลาย','ล็อคไม่แน่น','ด่าง','อื่น ๆ')
  defectSpots  = BuildList ($jobs.defect_spot)  @('ระหว่างเส้น','ใกล้หัวจรวด','ใกล้ห่วง','ตะขอ','ทั้งเส้น')
  methods      = BuildList ($jobs.method)       @('เชื่อมไฟ','เชื่อมเลเซอร์','เชื่อมเลเซอร์ + เชื่อมไฟ','หลอม','ผลิตใหม่','ไม่ซ่อม')
  # ช่างเป็นรายชื่อคนจริง ไม่ใช่ค่าที่พิมพ์ผิดได้ง่าย — ไม่ปิดใช้ใครเลย
  # ช่างที่เพิ่งเริ่มมีงานใบเดียวต้องยังเลือกได้อยู่
  technicians  = @{ values = @($jobs.technician | Where-Object { $_ } | Select-Object -Unique | Sort-Object); disabled = @() }
}

# ─────────── รวมกับของที่ยังอยู่บน cloud ไม่ทิ้งอะไรเลย ───────────
$existing = @{}
$res = Invoke-WebRequest -Method Get -Headers $H -UseBasicParsing -Uri "$($cfg.supabaseUrl)/rest/v1/lists?select=*"
# ต้องพักลงตัวแปรก่อน — ConvertFrom-Json ใน PS 5.1 ส่ง array ทั้งก้อนเป็นชิ้นเดียว
# ถ้าครอบ @() ตรงท่อเลย จะได้ array ซ้อน array แล้ว $row กลายเป็นทั้งก้อน
$parsed = $res.Content | ConvertFrom-Json
foreach ($row in @($parsed)) { $existing[$row.name] = $row }

$rows = @()
Say ''
Say ('{0,-13} {1,8} {2,8} {3,8}   {4}' -f 'รายการ','ตอนนี้','จะเป็น','ปิดใช้','ได้คืน') 'Cyan'
foreach ($k in $L.Keys) {
  $oldV = @(); $oldD = @()
  if ($existing.ContainsKey($k)) { $oldV = @($existing[$k].values); $oldD = @($existing[$k].disabled) }
  $values   = @(($oldV + $L[$k].values) | Where-Object { $_ } | Select-Object -Unique | Sort-Object)
  $disabled = @(($oldD + $L[$k].disabled) | Where-Object { $_ } | Select-Object -Unique | Where-Object { $values -contains $_ })
  $rows += [pscustomobject]@{ name = $k; values = $values; disabled = $disabled }
  Say ('{0,-13} {1,8} {2,8} {3,8}   +{4}' -f $k, $oldV.Count, $values.Count, $disabled.Count, ($values.Count - $oldV.Count))
}

# userNames ไม่แตะ — เป็นชื่อผู้ใช้ ไม่ใช่รายการตัวเลือก
Say ''
if ($existing.ContainsKey('userNames')) { Say "ชื่อผู้ใช้ปัจจุบัน: $($existing['userNames'].values -join ' · ') (ไม่แตะ)" 'DarkGray' }

if ($Preview) { Say ''; Say 'โหมดดูผลอย่างเดียว — ยังไม่ได้เขียนอะไร' 'Yellow'; exit 0 }

$body = ConvertTo-Json @($rows) -Depth 5 -Compress
Invoke-RestMethod -Method Post -Uri "$($cfg.supabaseUrl)/rest/v1/lists" `
  -Headers ($H + @{ 'Content-Type' = 'application/json'; Prefer = 'resolution=merge-duplicates,return=minimal' }) `
  -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
Say 'เขียนรายการตัวเลือกกลับขึ้น Supabase แล้ว' 'Green'
