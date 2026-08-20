-- ═══════════════════════════════════════════════════════════
--  แก้สูตรส่วนต่างน้ำหนัก
--  วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
--  รันครั้งเดียวพอ (รันซ้ำก็ไม่พัง)
--
--  ปัญหา: สูตรเดิมใช้ coalesce(...,0) แปลงค่าว่างเป็นศูนย์
--         งานที่ยังไม่ปิด (ยังไม่มีน้ำหนักส่ง) จึงถูกคำนวณเป็น
--         "ทองสูญเสียเท่ากับน้ำหนักทั้งชิ้น" ทำให้ตัวเลขสูญเสียในรายงานพองผิดจริง
--
--  แก้เป็น: ถ้ายังชั่งไม่ครบ 2 ครั้ง ให้เป็นค่าว่าง ไม่ใช่ตัวเลข
-- ═══════════════════════════════════════════════════════════

alter table public.jobs drop column if exists weight_loss;

alter table public.jobs
  add column weight_loss numeric(10,3)
  generated always as (
    case
      when weight_in is null or weight_out is null then null
      else weight_in + coalesce(weight_add, 0) - weight_out
    end
  ) stored;

-- ตรวจผล: งานที่ยังไม่ปิดต้องขึ้นเป็นค่าว่าง ไม่ใช่ตัวเลข
select id, status, weight_in, weight_out, weight_loss
from public.jobs
order by id
limit 20;
