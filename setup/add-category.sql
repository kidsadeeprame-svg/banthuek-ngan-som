-- ═══════════════════════════════════════════════════════════
--  เพิ่มคอลัมน์ "ประเภทสินค้า" (สร้อยคอ / สร้อยข้อมือ / ฯลฯ)
--
--  วิธีรัน: Supabase Dashboard → SQL Editor → วางทั้งหมด → Run
--  รันซ้ำได้ ไม่พัง ไม่แตะข้อมูลงานเดิม
--
--  หมายเหตุชื่อ: คอลัมน์ product_type เดิมตอนนี้แสดงเป็น "แผนกส่งงาน"
--  ในแอป ชื่อในฐานข้อมูลไม่เปลี่ยน เพราะงาน 1,417 ใบผูกอยู่กับชื่อนี้
-- ═══════════════════════════════════════════════════════════

alter table public.jobs
  add column if not exists category text;

-- ตรวจผล: ต้องขึ้นมา 1 แถว
select column_name, data_type
from   information_schema.columns
where  table_schema = 'public' and table_name = 'jobs' and column_name = 'category';
