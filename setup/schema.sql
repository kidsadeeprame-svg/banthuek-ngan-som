-- ═══════════════════════════════════════════════════════════
--  บันทึกงานซ่อม — โครงฐานข้อมูล Supabase
--  วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
--  รันซ้ำได้ ไม่พัง (ใช้ if not exists / drop policy if exists)
-- ═══════════════════════════════════════════════════════════

-- ─────────── 1. ตารางงานซ่อม ───────────
create table if not exists public.jobs (
  id            text primary key,                 -- F69-0001
  date_in       date,
  date_out      date,
  status        text not null default 'รับงาน',
  doc_no        text,
  branch        text,
  product_type  text,                             -- แสดงเป็น "แผนกส่งงาน" ในแอป
  category      text,                             -- ประเภทสินค้า เช่น สร้อยคอ สร้อยข้อมือ
  pattern       text,
  part          text,
  defect_kind   text,
  defect_spot   text,
  weight_in     numeric(10,3),
  weight_out    numeric(10,3),
  weight_add    numeric(10,3),
  method        text,
  technician    text,
  recorded_by   text,
  notes         text,
  photos        jsonb not null default '{}'::jsonb,   -- {slot: {view, thumb}}
  legacy        boolean not null default false,
  deleted       boolean not null default false,
  history       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ส่วนต่างน้ำหนัก: (รับ + เติม) − ส่ง  ค่าบวก = ทองสูญเสีย
-- คำนวณในฐานข้อมูลเพื่อให้รายงานเชื่อถือได้ ไม่ต้องหวังพึ่งฝั่งแอป
--
-- ต้องเป็นค่าว่างเมื่อยังชั่งไม่ครบ 2 ครั้ง ห้ามใช้ coalesce(...,0)
-- ไม่งั้นงานที่ยังไม่ปิดจะถูกนับว่า "ทองสูญเสียเท่ากับน้ำหนักทั้งชิ้น"
alter table public.jobs
  drop column if exists weight_loss;
alter table public.jobs
  add column weight_loss numeric(10,3)
  generated always as (
    case
      when weight_in is null or weight_out is null then null
      else weight_in + coalesce(weight_add, 0) - weight_out
    end
  ) stored;


-- ตารางที่สร้างไว้ก่อนหน้านี้ยังไม่มีคอลัมน์นี้ — เพิ่มให้ด้วย
-- (create table ข้างบนใช้ if not exists จึงไม่แตะตารางเดิม)
alter table public.jobs
  add column if not exists category text;

create index if not exists jobs_date_in_idx     on public.jobs (date_in desc);
create index if not exists jobs_status_idx      on public.jobs (status);
create index if not exists jobs_branch_idx      on public.jobs (branch);
create index if not exists jobs_technician_idx  on public.jobs (technician);
create index if not exists jobs_updated_at_idx  on public.jobs (updated_at desc);

-- ─────────── 2. รายการตัวเลือก (dropdown) ───────────
create table if not exists public.lists (
  name       text primary key,                       -- patterns / methods / ...
  values     jsonb not null default '[]'::jsonb,
  disabled   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ─────────── 3. ประทับเวลาแก้ไขอัตโนมัติ ───────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists jobs_touch  on public.jobs;
create trigger jobs_touch  before update on public.jobs
  for each row execute function public.touch_updated_at();

drop trigger if exists lists_touch on public.lists;
create trigger lists_touch before update on public.lists
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════
--  4. ความปลอดภัย (RLS)
--  anon key ที่ฝังอยู่ในหน้าเว็บ "อ่านอะไรไม่ได้เลย" ถ้ายังไม่ล็อกอิน
--  ต้องผ่าน Supabase Auth ก่อนเท่านั้น
-- ═══════════════════════════════════════════════════════════
alter table public.jobs  enable row level security;
alter table public.lists enable row level security;

drop policy if exists jobs_rw  on public.jobs;
create policy jobs_rw  on public.jobs
  for all to authenticated using (true) with check (true);

drop policy if exists lists_rw on public.lists;
create policy lists_rw on public.lists
  for all to authenticated using (true) with check (true);

-- ═══════════════════════════════════════════════════════════
--  5. ที่เก็บรูป
--  bucket แบบ private — รูปเปิดดูได้เฉพาะคนที่ล็อกอินแล้ว
-- ═══════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_read   on storage.objects;
create policy photos_read   on storage.objects
  for select to authenticated using (bucket_id = 'photos');

drop policy if exists photos_write  on storage.objects;
create policy photos_write  on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to authenticated using (bucket_id = 'photos');

-- ตั้งใจไม่ให้สิทธิ์ลบรูป — งานที่ "ลบ" คือซ่อน (deleted = true) รูปยังอยู่

-- ═══════════════════════════════════════════════════════════
--  เสร็จแล้ว — ขั้นต่อไปคือสร้างผู้ใช้ 2 คนใน Authentication → Users
--  ดูขั้นตอนในไฟล์ docs/ติดตั้ง.md
-- ═══════════════════════════════════════════════════════════
