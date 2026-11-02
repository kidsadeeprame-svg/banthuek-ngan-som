-- ═══════════════════════════════════════════════════════════
--  เปิดสิทธิ์ลบรูปใน bucket photos ชั่วคราว
--  ใช้เพื่อให้ setup/storage-audit.ps1 -Delete ลบไฟล์กำพร้าได้
--
--  ปกติแอป "ไม่ให้" ลบรูปโดยตั้งใจ (ดู schema.sql) งานที่ลบแค่ถูกซ่อน
--  รูปยังอยู่ กันพลาดลบของจริง — เปิดแล้วต้องปิดทันทีด้วย
--  storage-delete-close.sql หลังลบเสร็จ
--
--  วิธีรัน: Supabase Dashboard → SQL Editor → วาง → Run
-- ═══════════════════════════════════════════════════════════

drop policy if exists photos_delete_tmp on storage.objects;
create policy photos_delete_tmp on storage.objects
  for delete to authenticated using (bucket_id = 'photos');
