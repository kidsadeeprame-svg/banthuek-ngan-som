/* ═══════════════════════════════════════════════════════════
   ตั้งค่าการเชื่อมต่อ — แก้ไฟล์นี้ไฟล์เดียวก็ใช้งานได้
   ═══════════════════════════════════════════════════════════

   หาค่า 2 อันแรกได้จาก:
   Supabase Dashboard → Project Settings → Data API
     • Project URL       → SUPABASE_URL
     • anon / public key → SUPABASE_ANON_KEY

   ⚠  anon key เปิดเผยได้ ไม่ใช่ความลับ — ออกแบบมาให้ฝังในหน้าเว็บอยู่แล้ว
      ตัวที่กันข้อมูลจริงคือ RLS + การล็อกอิน (ดู setup/schema.sql)
      ห้ามเอา service_role key มาใส่ที่นี่เด็ดขาด
*/

window.CONFIG = {

  SUPABASE_URL:      'https://owxoorumizncocpocmwi.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Nf0lHfIyI7L7jywOnWnVCQ_aPV88K6y',

  /* ─────────── ผู้ใช้งาน ───────────
     ชื่อ = ที่แสดงบนหน้าล็อกอิน
     email = บัญชีจริงใน Supabase Auth (ผู้ใช้ไม่เห็น ไม่ต้องพิมพ์)
     PIN 6 หลัก = รหัสผ่านของบัญชีนั้น

     เพิ่มคนใหม่: สร้าง user ใน Supabase → Authentication → Users
     แล้วมาเพิ่มบรรทัดตรงนี้ */
  USERS: [
    { name: 'ผู้ใช้ 1', email: 'user1@banthuek.local' },
    { name: 'ผู้ใช้ 2', email: 'user2@banthuek.local' },
  ],

  /* จำนวนหลักของ PIN — Supabase บังคับรหัสผ่านอย่างน้อย 6 ตัว จึงต้องเป็น 6 */
  PIN_LENGTH: 6,

  /* ขนาดรูปที่อัปขึ้น cloud (ด้านยาวสุด, พิกเซล) */
  PHOTO_VIEW:  1280,   // รูปดูจริง ~180 KB
  PHOTO_THUMB: 400,    // รูปย่อ ~30 KB เก็บถาวร
};
