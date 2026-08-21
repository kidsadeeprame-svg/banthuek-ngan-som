/* ═══════════════════════════════════════════════════════════
   บันทึกงานซ่อม — หน้าจอ
   ข้อมูลผ่าน Store (เครื่อง) → Supabase (cloud)
   ═══════════════════════════════════════════════════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const C  = window.CONFIG;

const DEFAULT_LISTS = {
  /* productTypes = "แผนกส่งงาน" บนหน้าจอ — ชื่อในโค้ดกับฐานข้อมูลยังเป็นของเดิม
     เพราะงาน 1,417 ใบผูกกับคอลัมน์ product_type อยู่ เปลี่ยนชื่อคอลัมน์
     ตอนนี้เสี่ยงเกินความจำเป็น เปลี่ยนแค่ป้ายที่ผู้ใช้เห็นก็พอ */
  productTypes: ['MOD-96.50%', 'DDD-75.00%'],
  categories:   ['สร้อยคอ', 'สร้อยข้อมือ'],
  patterns:     [],
  parts:        [],
  defectKinds:  ['ขาด', 'ดีด', 'หัก', 'บุบ', 'หลุด', 'แตกลาย', 'ล็อคไม่แน่น', 'ด่าง', 'อื่น ๆ'],
  defectSpots:  ['ระหว่างเส้น', 'ใกล้หัวจรวด', 'ใกล้ห่วง', 'ตะขอ', 'ทั้งเส้น', 'หัวจรวด'],
  methods:      ['เชื่อมไฟ', 'เชื่อมเลเซอร์', 'เชื่อมเลเซอร์ + เชื่อมไฟ', 'หลอม', 'เป่าไฟ', 'ผลิตใหม่', 'ไม่ซ่อม'],
  technicians:  [],
};
const PHOTO_SLOTS = ['imgDoc', 'imgDefect', 'imgWeightIn', 'imgWeightOut', 'imgDone'];
const SLOT_LABEL = {
  imgDoc: 'ใบส่งซ่อม', imgDefect: 'ภาพชำรุด', imgWeightIn: 'ชั่งตอนรับ',
  imgWeightOut: 'ชั่งตอนส่ง', imgDone: 'งานเสร็จ',
};

let me = null;          // { name, email }
let editing = null;     // id ที่กำลังแก้
let draftPhotos = {};   // slot -> { view: Blob, thumb: Blob, url } | null (=ลบ)
let lists = {}, disabled = {};

/* ═════════════ สิทธิ์ผู้ใช้ + ชื่อที่แสดง ═════════════
   admin = เห็นครบทุกหน้า และแก้ชื่อที่แสดงของทุกคนได้
   staff = ไม่เห็นหน้ารายงาน
   ชื่อที่แสดงเก็บใน lists.userNames (ซิงก์ผ่าน Supabase เหมือนรายการอื่น)
   และสำเนาไว้ใน localStorage เพราะหน้าล็อกอินต้องรู้ชื่อ
   ก่อนจะเปิดฐานข้อมูลได้ */

C.USERS.forEach((u, i) => { u.i = i; });

const isAdmin = () => !!me && (me.role || 'admin') === 'admin';   // ไม่ระบุ role = admin

const NAMES_KEY = 'gsrUserNames';
let userNames = [];
try { userNames = JSON.parse(localStorage.getItem(NAMES_KEY)) || []; } catch { userNames = []; }

const nameOf = i => userNames[i] || C.USERS[i]?.name || '—';

/* ดึงชื่อล่าสุดจาก lists มาเก็บไว้ให้หน้าล็อกอินใช้ครั้งหน้า */
function cacheNames() {
  const v = lists.userNames;
  if (!Array.isArray(v) || !v.length) return;
  userNames = v;
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(v)); } catch {}
}

/* ซ่อนหน้ารายงานสำหรับ staff — ทั้งปุ่มและตัวหน้า
   เผื่อกำลังเปิดหน้ารายงานค้างอยู่ตอนสลับผู้ใช้ ให้เด้งกลับหน้าบันทึก */
function applyRole() {
  const admin = isAdmin();
  // ซ่อนทั้งเมนูล่าง (มือถือ) และเมนูซ้าย (จอคอม)
  $$('[data-view="report"]').forEach(el => { el.hidden = !admin; });
  $('#blockUsers').hidden = !admin;
  if (!admin && !$('#view-report').hidden) showView('form');
}

/* ═════════════ เครื่องมือ ═════════════ */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w = 4) => String(n).padStart(w, '0');
/* ต้องอ่านวันที่จากเวลาเครื่อง ห้ามใช้ toISOString()
   toISOString แปลงเป็นเวลาสากลซึ่งช้ากว่าไทย 7 ชั่วโมง
   บันทึกงานก่อน 07:00 จะได้วันที่เป็นเมื่อวาน */
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
const todayISO = () => isoOf(new Date());

function thaiDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-').map(Number);
  return y ? `${pad(d, 2)}/${pad(m, 2)}/${y + 543}` : '—';
}
const beYear2 = iso => String((Number((iso || todayISO()).slice(0, 4)) + 543) % 100).padStart(2, '0');
const branchOf = doc => (String(doc || '').match(/^([A-Za-z0-9]{5})-/) || [])[1] || '';

function lossOf(j) {
  if (j.weightIn == null || j.weightOut == null) return null;
  return +((j.weightIn + (j.weightAdd || 0)) - j.weightOut).toFixed(3);
}

function nextJobId() {
  const prefix = `F${beYear2(todayISO())}-`;
  const used = Store.jobs.filter(j => j.id.startsWith(prefix))
    .map(j => Number(j.id.slice(prefix.length)) || 0);
  return prefix + pad(Math.max(0, ...used) + 1);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

const activeList = name => (lists[name] || []).filter(v => !(disabled[name] || []).includes(v));

function fillSelect(el, values, current, placeholder = '— เลือก —') {
  const extra = current && !values.includes(current) ? [current] : [];
  el.innerHTML = `<option value="">${placeholder}</option>` +
    [...values, ...extra].map(v => `<option${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('') +
    `<option value="__new">➕ เพิ่มค่าใหม่…</option>`;
}

/* ═════════════ ชิปเลือกค่า ═════════════
   ดีไซน์ 1b/1g เลือกค่าด้วยชิป กดทีเดียวจบ ไม่ต้องเปิด dropdown ทีละช่อง
   ค่าจริงยังเก็บใน <select> ที่ซ่อนไว้เหมือนเดิม — readForm/openJob/validate
   ทำงานต่อได้โดยไม่ต้องแก้อะไร ชิปเป็นแค่หน้ากากที่คอยตั้งค่า select ให้

   ลวดลายมี 195 ค่า โชว์เป็นชิปทั้งหมดไม่ไหว จึงเรียงตามที่ใช้จริงจากงาน
   ที่บันทึกไว้ โชว์แค่ N ตัวแรก ที่เหลืออยู่หลังปุ่ม "ทั้งหมด" ซึ่งค้นหาได้ */

function useCount(field) {
  const m = new Map();
  Store.jobs.forEach(j => {
    if (j.deleted) return;
    const v = j[field]; if (v) m.set(v, (m.get(v) || 0) + 1);
  });
  return m;
}
const byUse = (cnt) => (a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0) || a.localeCompare(b, 'th');

function chipOptions(box) {
  const sel = $('#' + box.dataset.for);
  return [...sel.options].map(o => o.value).filter(v => v && v !== '__new');
}

function renderChips(box) {
  const sel = $('#' + box.dataset.for);
  if (!sel) return;
  const all = chipOptions(box);
  let top;
  if (box.dataset.all) top = all;
  else {
    const n = +box.dataset.top || 4;
    top = [...all].sort(byUse(useCount(box.dataset.field))).slice(0, n);
    // ค่าที่เลือกอยู่ต้องเห็นเสมอ ถึงจะไม่ติดอันดับใช้บ่อยก็ตาม
    if (sel.value && !top.includes(sel.value)) top.unshift(sel.value);
  }
  const lead = box.dataset.lead ? `<span class="chip-lead">${esc(box.dataset.lead)}</span>` : '';
  const none = box.dataset.none
    ? `<button type="button" class="chip chip-none${sel.value ? '' : ' on'}" data-v="">${esc(box.dataset.none)}</button>`
    : '';
  const more = (box.dataset.all || all.length <= top.length) ? ''
    : `<button type="button" class="chip chip-more" data-more="1">ทั้งหมด ▾</button>`;
  box.innerHTML = lead + none + top.map(v =>
    `<button type="button" class="chip${v === sel.value ? ' on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`
  ).join('') + more;
}
const paintChips = () => $$('.chips[data-for]').forEach(renderChips);

function setChip(box, v) {
  const sel = $('#' + box.dataset.for);
  sel.value = v;
  sel.dispatchEvent(new Event('change', { bubbles: true }));   // ให้ตัวจับ change เดิมทำงานต่อ
  renderChips(box);
  updateProgress();
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.chips [data-v], .chips [data-more]');
  if (!btn) return;
  const box = btn.closest('.chips');
  if (btn.dataset.more !== undefined) return openPicker(box);
  setChip(box, btn.dataset.v);
});

/* ─── ตัวเลือกทั้งหมด (ค้นหาได้) ─── */
let pickerBox = null;

function openPicker(box) {
  pickerBox = box;
  const lb = box.closest('.fset')?.querySelector('label');
  $('#pickerTitle').textContent = (lb ? lb.textContent : 'เลือกค่า').replace('*', '').trim();
  $('#pickerSearch').value = '';
  $('#picker').hidden = false;
  paintPicker();
  setTimeout(() => $('#pickerSearch').focus(), 40);
}
function closePicker() { $('#picker').hidden = true; pickerBox = null; }

function paintPicker() {
  if (!pickerBox) return;
  const sel = $('#' + pickerBox.dataset.for);
  const q = $('#pickerSearch').value.trim().toLowerCase();
  const cnt = useCount(pickerBox.dataset.field);
  const hits = chipOptions(pickerBox)
    .filter(v => !q || v.toLowerCase().includes(q))
    .sort(byUse(cnt));
  $('#pickerList').innerHTML = hits.length
    ? hits.map(v => `<button type="button" class="${v === sel.value ? 'on' : ''}" data-pv="${esc(v)}">
        <span>${esc(v)}</span><i>${cnt.get(v) || 0}</i></button>`).join('')
    : `<p class="picker-empty">ไม่พบ “${esc(q)}”</p>`;
}
$('#pickerSearch').addEventListener('input', paintPicker);
$('#pickerClose').addEventListener('click', closePicker);
$('#picker').addEventListener('click', e => {
  if (e.target.id === 'picker') return closePicker();
  const b = e.target.closest('[data-pv]');
  if (b && pickerBox) { setChip(pickerBox, b.dataset.pv); closePicker(); }
});

/* ─── แถบความคืบหน้าท้ายฟอร์ม ───
   นับจาก validate() ตัวเดียวกับตอนกดบันทึก ตัวเลขจึงตรงกันเสมอ */
function requiredTotal(f) {
  return 6                                        // ใบซ่อม แผนก ลวดลาย นน.รับ ลักษณะ ตำแหน่ง
       + 1                                        // ภาพชำรุด
       + (f.status === 'เสร็จสิ้น' ? 3 : 0);      // นน.ส่ง วิธีซ่อม ช่าง
}
function updateProgress() {
  if ($('#view-form').hidden) return;
  const f = readForm();
  const miss  = validate(f).length;
  const total = requiredTotal(f);
  const done  = Math.max(0, total - miss);
  const txt = $('#progText');
  txt.innerHTML = miss ? `เหลือช่องบังคับ <b>${miss}</b> ช่อง` : `กรอกครบ <b>${done}/${total}</b>`;
  txt.classList.toggle('warn', miss > 0);
  $('#progFill').style.width = (total ? done / total * 100 : 0) + '%';
  $('#btnSave').classList.toggle('go-close', f.status === 'เสร็จสิ้น');
  $('#btnSave').textContent = f.status === 'เสร็จสิ้น' ? 'ปิดงาน' : 'บันทึก';
}
$('#view-form').addEventListener('input',  updateProgress);
$('#view-form').addEventListener('change', updateProgress);

/* ช่อง <input type="date"> แสดง ค.ศ. เสมอ แก้ไม่ได้ จึงกำกับ พ.ศ. ที่ป้ายชื่อ */
function syncBE() {
  $$('.be').forEach(el => {
    const v = $('#' + el.dataset.be)?.value;
    el.textContent = v ? thaiDate(v) : '';
  });
}
['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  if (e.target.type === 'date') syncBE();
}));

/* ═════════════ สถานะการเชื่อมต่อ ═════════════ */

let syncState = 'ok';
function paintSync() {
  const b = $('#btnSync'), t = $('#syncText');
  const p = Store.pending;
  const state = syncState === 'syncing' ? 'syncing'
              : !navigator.onLine || syncState === 'offline' ? 'offline'
              : p > 0 ? 'pending' : 'ok';
  b.dataset.state = state;
  t.textContent = { syncing: 'กำลังส่ง…', offline: p ? `ค้าง ${p}` : 'ออฟไลน์',
                    pending: `ค้าง ${p}`, ok: 'ซิงก์แล้ว' }[state];

  const banner = $('#banner');
  if (state === 'offline') {
    banner.hidden = false;
    banner.className = 'banner';
    banner.textContent = p
      ? `ออฟไลน์ — บันทึกไว้ในเครื่องแล้ว ${p} รายการ จะส่งให้อัตโนมัติเมื่อเน็ตกลับมา`
      : 'ออฟไลน์ — ยังบันทึกงานได้ตามปกติ';
  } else banner.hidden = true;
}
Store.onChange(paintSync);
window.addEventListener('online',  () => { syncState = 'ok'; paintSync(); });
window.addEventListener('offline', () => { syncState = 'offline'; paintSync(); });

async function doSync(loud = false) {
  syncState = 'syncing'; paintSync();
  const r = await Store.sync();
  syncState = r === 'offline' ? 'offline' : 'ok';
  paintSync();
  if (loud) toast({ ok: 'ซิงก์เรียบร้อย', offline: 'ยังต่อเน็ตไม่ได้ — ข้อมูลอยู่ในเครื่องครบ',
                    auth: 'เซสชันหมดอายุ กรุณาล็อกอินใหม่', error: 'ซิงก์ไม่สำเร็จ',
                    skip: 'ยังไม่ได้ล็อกอิน' }[r]);
  if (r === 'ok') { refreshAll(); }
  if (r === 'auth') signOut();
  return r;
}
$('#btnSync').addEventListener('click', () => doSync(true));
$('#btnSyncNow').addEventListener('click', () => doSync(true));
setInterval(() => { if (me && navigator.onLine) doSync(false); }, 60000);

/* ═════════════ ล็อกอิน ═════════════ */

let pinBuf = '', pinUser = null, pinBusy = false;

function renderLogin() {
  $('#userChips').innerHTML = C.USERS
    .map((u, i) => `<button data-u="${i}">${esc(nameOf(i))}</button>`).join('');
  $('#loginStep1').hidden = false;
  $('#loginStep2').hidden = true;
  $('#pinError').hidden = true;
}

function renderPin() {
  $('#pinDots').innerHTML = Array.from({ length: C.PIN_LENGTH },
    (_, i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join('');
}

$('#userChips').addEventListener('click', e => {
  const b = e.target.closest('[data-u]'); if (!b) return;
  pinUser = C.USERS[+b.dataset.u];
  pinBuf = '';
  $('#loginName').textContent = nameOf(pinUser.i);
  $('#loginStep1').hidden = true;
  $('#loginStep2').hidden = false;
  $('#pinError').hidden = true;
  renderPin();
});

$('.keypad').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b || pinBusy) return;
  const k = b.dataset.k;
  if (k === 'cancel') return renderLogin();
  if (k === 'back') { pinBuf = pinBuf.slice(0, -1); return renderPin(); }
  if (pinBuf.length >= C.PIN_LENGTH) return;
  pinBuf += k; renderPin();
  if (pinBuf.length === C.PIN_LENGTH) submitPin();
});

async function submitPin() {
  pinBusy = true;
  const err = $('#pinError');
  err.hidden = false; err.textContent = 'กำลังตรวจสอบ…';
  try {
    await API.signIn(pinUser.email, pinBuf);
    err.hidden = true;
    await enterApp(pinUser);
  } catch (e) {
    err.hidden = false;
    err.textContent = e.badPin ? 'PIN ไม่ถูกต้อง'
      : e.offline ? 'ต่อเน็ตไม่ได้ — ต้องออนไลน์ตอนล็อกอินครั้งแรกของเครื่องนี้'
      : 'เข้าสู่ระบบไม่สำเร็จ: ' + e.message;
    pinBuf = ''; renderPin();
  } finally { pinBusy = false; }
}

async function enterApp(user) {
  me = user;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#curUser').textContent = nameOf(me.i);

  const boot = await Store.boot();
  lists = boot.lists || JSON.parse(JSON.stringify(DEFAULT_LISTS));
  disabled = boot.disabled || {};

  paintSync();
  startNewJob();
  refreshAll();

  const r = await doSync(false);

  /* เอาของบน cloud มาก่อนเสมอ แล้วค่อยตัดสินใจว่าต้องส่งค่าตั้งต้นขึ้นไปไหม
     เดิมเช็ค !boot.lists คือ "เครื่องนี้ยังไม่มีแคช" ซึ่งผิด —
     เครื่องใหม่ (หรือเครื่องที่เพิ่งลบแอปแล้วติดตั้งใหม่) ยังไม่มีแคช
     จึงเอา DEFAULT_LISTS ไปทับลวดลาย/Part/วิธีซ่อมของจริงบน cloud ทั้งชุด
     ต้องเช็คว่า "cloud ยังไม่มีรายการ" ต่างหาก */
  lists    = Store.lists    || lists;
  disabled = Store.disabled || disabled;
  if (r === 'ok' && !Store.lists) await Store.saveLists(lists, disabled);
  refreshAll();
}

function signOut() {
  API.signOut();
  me = null; pinBuf = '';
  $('#app').hidden = true;
  $('#login').hidden = false;
  renderLogin();
}
$('#btnUser').addEventListener('click', () => { if (confirm('ออกจากระบบ?')) signOut(); });
$('#btnSignOut').addEventListener('click', () => { if (confirm('ออกจากระบบ?')) signOut(); });

/* ═════════════ สลับหน้า ═════════════ */

/* เมนูล่าง (มือถือ) กับเมนูซ้าย (จอคอม) ใช้ตัวจับเดียวกัน */
$$('.tabbar, .rail-nav').forEach(nav => nav.addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (b) showView(b.dataset.view);
}));

let curView = 'form';
let reportScope = '';

function paintTopbar() {
  const editing_ = !!editing;
  const meta = {
    form:     [editing_ ? 'แก้ไขงานซ่อม' : 'งานซ่อมใหม่', editing_ ? 'แก้ไขงานที่บันทึกไว้' : 'รับงานเข้าระบบ'],
    list:     ['รายการงานซ่อม', ''],
    report:   ['รายงาน', reportScope],
    settings: ['ตั้งค่า', ''],
  }[curView] || ['บันทึกงานซ่อม', ''];
  $('#viewTitle').textContent = meta[0];
  $('#viewSub').textContent   = meta[1];
  // ขั้นตอน 1/2 เป็นของหน้าบันทึกเท่านั้น หน้าอื่นซ่อนไว้
  $('#stepper').hidden   = curView !== 'form';
  $('#formJobId').hidden = curView !== 'form';
}

function showView(name) {
  /* กันหน้ารายงานไว้ที่นี่ด้วย ไม่ใช่แค่ซ่อนปุ่ม
     เผื่อมีทางเข้าอื่น เช่น คลิกทะลุจากที่อื่น */
  if (name === 'report' && !isAdmin()) name = 'form';
  curView = name;
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  $$('.tab, .rnav').forEach(t => t.classList.toggle('is-on', t.dataset.view === name));
  if (name === 'list')     renderList();
  if (name === 'report')   renderReport();
  if (name === 'settings') renderSettings();
  if (name === 'form')     updateProgress();
  paintTopbar();
  /* จอคอม main เป็นตัวเลื่อนเอง ไม่ใช่ทั้งหน้า จึงต้องรีเซ็ตทั้งสองที่ */
  $('main').scrollTop = 0;
  window.scrollTo(0, 0);
}
const refreshAll = () => {
  cacheNames(); applyRole();
  renderList();
  if (isAdmin()) renderReport();
  renderSettings();
  refreshFormLists(readForm());
};

$('#stepper').addEventListener('click', e => {
  const b = e.target.closest('[data-step]'); if (!b) return;
  gotoStep(b.dataset.step);
});
function gotoStep(n) {
  $$('.step').forEach(s => s.classList.toggle('is-on', s.dataset.step === n));
  $$('.step-panel').forEach(p => { p.hidden = p.dataset.panel !== n; });
  $('main').scrollTop = 0; window.scrollTo(0, 0);
  updateProgress();
}

/* ═════════════ ฟอร์ม ═════════════ */

const F = {
  docNo: '#fDocNo', dateIn: '#fDateIn', branch: '#fBranch',
  productType: '#fProductType', category: '#fCategory',
  pattern: '#fPattern', part: '#fPart',
  weightIn: '#fWeightIn', defectKind: '#fDefectKind', defectSpot: '#fDefectSpot',
  status: '#fStatus', weightOut: '#fWeightOut', weightAdd: '#fWeightAdd',
  method: '#fMethod', technician: '#fTechnician', dateOut: '#fDateOut', notes: '#fNotes',
};
const SELECT_LIST = {
  fProductType: 'productTypes', fCategory: 'categories',
  fPattern: 'patterns', fPart: 'parts',
  fDefectKind: 'defectKinds', fDefectSpot: 'defectSpots',
  fMethod: 'methods', fTechnician: 'technicians',
};

function refreshFormLists(j = {}) {
  fillSelect($('#fProductType'), activeList('productTypes'), j.productType);
  fillSelect($('#fCategory'),    activeList('categories'),   j.category, '— ไม่ระบุ —');
  fillSelect($('#fPattern'),     activeList('patterns'),     j.pattern);
  fillSelect($('#fPart'),        activeList('parts'),        j.part, '— ไม่มี —');
  fillSelect($('#fDefectKind'),  activeList('defectKinds'),  j.defectKind);
  fillSelect($('#fDefectSpot'),  activeList('defectSpots'),  j.defectSpot);
  fillSelect($('#fMethod'),      activeList('methods'),      j.method);
  fillSelect($('#fTechnician'),  activeList('technicians'),  j.technician);
  $('#dlBranch').innerHTML = [...new Set(Store.jobs.map(x => x.branch).filter(Boolean))]
    .sort().map(b => `<option value="${esc(b)}">`).join('');
  paintChips();
}

Object.keys(SELECT_LIST).forEach(id => {
  $('#' + id).addEventListener('change', async e => {
    if (e.target.value !== '__new') return;
    const name = SELECT_LIST[id];
    const v = (prompt('เพิ่มค่าใหม่') || '').trim();
    if (v && !(lists[name] || []).includes(v)) {
      lists[name] = [...(lists[name] || []), v].sort((a, b) => a.localeCompare(b, 'th'));
      await Store.saveLists(lists, disabled);
    }
    const cur = readForm(); cur[id.slice(1, 2).toLowerCase() + id.slice(2)] = v;
    refreshFormLists(cur);
    e.target.value = v || '';
  });
});

function readForm() {
  const o = {};
  Object.entries(F).forEach(([k, sel]) => {
    const el = $(sel); if (!el) return;
    let v = el.value;
    if (['weightIn', 'weightOut', 'weightAdd'].includes(k)) v = v === '' ? null : Number(v);
    o[k] = v === '__new' ? '' : v;
  });
  return o;
}

$('#fDocNo').addEventListener('input', e => {
  const b = branchOf(e.target.value);
  const bf = $('#fBranch');
  if (b) {
    if (!bf.value || bf.dataset.auto === '1') { bf.value = b; bf.dataset.auto = '1'; }
    $('#branchHint').textContent = `เติมสาขา ${b} ให้อัตโนมัติ — แก้ได้`;
  } else {
    $('#branchHint').textContent = e.target.value ? 'แกะสาขาจากเลขนี้ไม่ได้ — กรอกสาขาเอง' : '';
  }
  paintDupe();
  paintDocMeta();          // สาขาถูกเติมด้วยโค้ด ไม่มี event ของตัวเอง ต้องสั่งวาดเอง
});
$('#fBranch').addEventListener('input', e => { e.target.dataset.auto = '0'; });

/* ─── เตือนเลขที่ใบส่งซ่อมซ้ำ ───
   ไม่ห้ามบันทึก เพราะใบเดิมถูกส่งซ่อมรอบสองได้จริง
   แต่ต้องเห็นก่อนว่ามันซ้ำ จะได้เลือกเองว่าจะแก้ใบเดิมหรือเปิดใบใหม่ */

let dupeOf = null;          // งานที่เลขซ้ำกับที่กำลังพิมพ์

function findDupe(docNo) {
  const v = String(docNo || '').trim().toLowerCase();
  if (!v) return null;
  return Store.jobs.find(j =>
    !j.deleted &&
    j.id !== editing &&                                   // งานที่กำลังแก้อยู่ไม่นับว่าซ้ำกับตัวเอง
    String(j.docNo || '').trim().toLowerCase() === v) || null;
}

function paintDupe() {
  dupeOf = findDupe($('#fDocNo').value);
  const box = $('#docDupe');
  box.hidden = !dupeOf;
  if (dupeOf) {
    $('#docDupeText').innerHTML =
      `เลขนี้เคยบันทึกแล้วเป็นงาน <b>${esc(dupeOf.id)}</b> ` +
      `(รับงาน ${esc(thaiDate(dupeOf.dateIn))} · ${esc(dupeOf.status)})`;
  }
}

$('#btnOpenDupe').addEventListener('click', () => { if (dupeOf) openJob(dupeOf.id); });

['#fWeightIn', '#fWeightOut', '#fWeightAdd'].forEach(s => $(s).addEventListener('input', updateDiff));

/* ดีไซน์ 1c วางน้ำหนักรับ/ส่ง/สูญเสีย เรียงกันให้เทียบได้ในบรรทัดเดียว
   ช่องสูญเสียจึงต้องอยู่เสมอ แสดง — ไว้จนกว่าจะชั่งครบทั้งสองครั้ง */
function updateDiff() {
  const f = readForm();
  const val = $('#diffValue'), lb = $('#diffLabel');
  $('#wInEcho').innerHTML = f.weightIn == null ? '—'
    : `${f.weightIn.toFixed(2)} <u>ก.</u>`;
  const d = lossOf(f);
  if (d === null) { val.className = 'ro-val'; val.textContent = '—'; lb.textContent = 'สูญเสีย · คิดให้'; return; }
  val.className = 'ro-val ' + (d > 0.005 ? 'bad' : 'ok');
  lb.textContent = d < -0.005 ? 'เกิน · คิดให้' : 'สูญเสีย · คิดให้';
  val.innerHTML = `${Math.abs(d).toFixed(2)} <u>ก.</u>`;
}

$('#fStatus').addEventListener('change', e => {
  if (e.target.value === 'เสร็จสิ้น' && !$('#fDateOut').value) {
    $('#fDateOut').value = todayISO(); syncBE();
  }
});

/* วันที่กับสาขาเติมให้เอง ปกติไม่ต้องแตะ จึงย่อเป็นบรรทัดเดียวเหนือช่องกรอก
   กด "แก้" ถึงจะกางช่องจริงออกมา */
function paintDocMeta() {
  const d = $('#fDateIn').value, b = $('#fBranch').value;
  $('#docMeta').textContent = `${d ? thaiDate(d) : '—'} · ${b ? 'สาขา ' + b : 'สาขาเติมอัตโนมัติ'}`;
}
$('#btnMetaEdit').addEventListener('click', () => {
  const box = $('#metaEdit');
  box.hidden = !box.hidden;
  $('#btnMetaEdit').textContent = box.hidden ? 'แก้' : 'ปิด';
});
['#fDateIn', '#fBranch'].forEach(s => $(s).addEventListener('input', paintDocMeta));
['#fDateIn', '#fBranch'].forEach(s => $(s).addEventListener('change', paintDocMeta));

function startNewJob() {
  editing = null; draftPhotos = {};
  $('#formJobId').textContent = nextJobId();
  $('#btnCancelEdit').hidden = true;
  Object.values(F).forEach(sel => { const el = $(sel); if (el) el.value = ''; });
  $('#fDateIn').value = todayISO();
  $('#fStatus').value = 'รับงาน';
  $('#fBranch').dataset.auto = '1';
  $('#metaEdit').hidden = true; $('#btnMetaEdit').textContent = 'แก้';
  refreshFormLists({});
  renderPhotoSlots(null);
  updateDiff(); syncBE(); paintDocMeta();
  $('#branchHint').textContent = '';
  paintDupe();
  $('#formError').hidden = true;
  gotoStep('1'); paintTopbar();
}

function openJob(id) {
  const j = Store.jobs.find(x => x.id === id); if (!j) return;
  editing = id; draftPhotos = {};
  $('#formJobId').textContent = j.id;
  $('#btnCancelEdit').hidden = false;
  refreshFormLists(j);
  Object.entries(F).forEach(([k, sel]) => { const el = $(sel); if (el) el.value = j[k] ?? ''; });
  $('#fBranch').dataset.auto = '0';
  $('#metaEdit').hidden = true; $('#btnMetaEdit').textContent = 'แก้';
  renderPhotoSlots(j);
  $('#branchHint').textContent = '';
  paintDupe();
  updateDiff(); syncBE(); paintDocMeta(); paintChips();
  $('#formError').hidden = true;
  showView('form');
  // งานที่ยังไม่ปิด เปิดมาที่ขั้นรับงาน · งานที่ปิดแล้วเปิดมาที่ขั้นปิดงานเลย
  gotoStep(j.status === 'รับงาน' ? '1' : '2');
}
$('#btnCancelEdit').addEventListener('click', startNewJob);

function validate(f) {
  const bad = [];
  if (!f.docNo.trim())    bad.push('เลขที่ใบส่งซ่อม');
  if (f.weightIn == null) bad.push('น้ำหนักรับซ่อม');
  if (!f.productType)     bad.push('แผนกส่งงาน');
  if (!f.pattern)         bad.push('ลวดลาย');
  if (!f.defectKind)      bad.push('อาการชำรุด — ลักษณะ');
  if (!f.defectSpot)      bad.push('อาการชำรุด — ตำแหน่ง');

  const cur = editing ? Store.jobs.find(j => j.id === editing) : null;
  const hasDefect = draftPhotos.imgDefect || (draftPhotos.imgDefect !== null && cur?.photos?.imgDefect);
  if (!hasDefect) bad.push('ภาพชำรุด');

  if (f.status === 'เสร็จสิ้น') {
    if (f.weightOut == null) bad.push('น้ำหนักส่ง');
    if (!f.method)     bad.push('วิธีซ่อม');
    if (!f.technician) bad.push('ช่างผู้ซ่อม');
  }
  return bad;
}

$('#btnSave').addEventListener('click', async () => {
  const f = readForm();
  const bad = validate(f);
  const err = $('#formError');
  if (bad.length) {
    err.hidden = false;
    err.innerHTML = 'ยังกรอกไม่ครบ: <b>' + bad.map(esc).join(' · ') + '</b>';
    err.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  err.hidden = true;

  /* เลขซ้ำ — ถามยืนยันก่อน ไม่ห้าม
     ตรวจซ้ำตรงนี้อีกรอบ เผื่อกรอกเลขไว้ก่อนที่งานอีกใบจะซิงก์ลงมา */
  const dupe = findDupe(f.docNo);
  if (dupe && !confirm(
      `เลขที่ใบส่งซ่อมนี้เคยบันทึกไว้แล้ว\n\n` +
      `${dupe.id} — รับงาน ${thaiDate(dupe.dateIn)} (${dupe.status})\n` +
      `${dupe.pattern || ''} ${dupe.defectKind || ''}`.trim() + `\n\n` +
      `จะบันทึกเป็นงานใหม่อีกใบไหม?\n` +
      `(ถ้าตั้งใจจะแก้ใบเดิม ให้กดยกเลิก แล้วกด "เปิดงานเดิม")`)) {
    paintDupe();
    $('#docDupe').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  $('#btnSave').disabled = true;

  try {
    const cur = editing ? Store.jobs.find(j => j.id === editing) : null;
    const id = editing || nextJobId();
    const stamp = { by: me.name, at: new Date().toISOString() };

    const photos = { ...(cur?.photos || {}) };
    const newBlobs = {};
    for (const [slot, data] of Object.entries(draftPhotos)) {
      if (data === null) { delete photos[slot]; continue; }
      const view  = `${id}/${slot}.view.jpg`;
      const thumb = `${id}/${slot}.thumb.jpg`;
      newBlobs[view] = data.view; newBlobs[thumb] = data.thumb;
      photos[slot] = { view, thumb };
    }

    let job;
    if (cur) {
      const changed = Object.keys(F).filter(k => String(cur[k] ?? '') !== String(f[k] ?? ''));
      job = { ...cur, ...f, branch: f.branch || branchOf(f.docNo), photos };
      if (changed.length || Object.keys(newBlobs).length)
        job.history = [...(cur.history || []), { ...stamp, action: 'แก้ไข', fields: changed }];
    } else {
      job = {
        id, ...f, branch: f.branch || branchOf(f.docNo),
        recordedBy: me.name, photos, legacy: false, deleted: false,
        history: [{ ...stamp, action: 'สร้าง' }],
      };
    }

    await Store.saveJob(job, newBlobs);
    toast(cur ? 'บันทึกการแก้ไขแล้ว' : `บันทึก ${id} แล้ว`);
    startNewJob();
    renderList(); renderReport();
  } catch (e) {
    err.hidden = false; err.textContent = 'บันทึกไม่สำเร็จ: ' + e.message;
  } finally {
    $('#btnSave').disabled = false;
  }
});

/* ═════════════ รูปถ่าย ═════════════ */

async function renderPhotoSlots(job) {
  for (const slot of PHOTO_SLOTS) {
    const el = $(`.photo-slot[data-slot="${slot}"]`); if (!el) continue;
    const draft = draftPhotos[slot];
    let url = null, missing = '';

    if (draft) url = draft.url;
    else if (draft !== null && job?.photos?.[slot]) {
      const p = job.photos[slot];
      if (p.missing) missing = p.missing;
      else url = await Store.photoUrl(p.thumb || p.view);
    }

    el.classList.toggle('has-img', !!url);
    el.classList.toggle('legacy', !url && !!missing);
    el.innerHTML = url
      ? `<img src="${url}" alt=""><button class="rm" data-rm="${slot}">✕</button>`
      : missing
        ? `<span>${esc(SLOT_LABEL[slot])}<br>📁 ${esc(missing)}</span>`
        : `<span>${esc(SLOT_LABEL[slot])}${slot === 'imgDefect' ? ' <i class="req">*</i>' : ''}</span>`;
  }
}

let pickingSlot = null;
document.addEventListener('click', async e => {
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    draftPhotos[rm.dataset.rm] = null;
    renderPhotoSlots(editing ? Store.jobs.find(j => j.id === editing) : null);
    return;
  }
  const slot = e.target.closest('.photo-slot');
  if (!slot) return;
  const key = slot.dataset.slot;
  const draft = draftPhotos[key];
  if (draft?.url) return openLightbox(draft.url);
  const job = editing ? Store.jobs.find(j => j.id === editing) : null;
  const p = job?.photos?.[key];
  if (p && !p.missing) {
    const big = await Store.photoUrl(p.view || p.thumb);
    if (big) return openLightbox(big);
  }
  pickingSlot = key;
  $('#filePicker').click();
});

$('#filePicker').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !pickingSlot) return;
  toast('กำลังย่อรูป…');
  const [view, thumb] = await Promise.all([
    resize(file, C.PHOTO_VIEW, .75), resize(file, C.PHOTO_THUMB, .7),
  ]);
  draftPhotos[pickingSlot] = { view, thumb, url: URL.createObjectURL(thumb) };
  await renderPhotoSlots(editing ? Store.jobs.find(j => j.id === editing) : null);
  toast(`เพิ่ม${SLOT_LABEL[pickingSlot]}แล้ว`);
  pickingSlot = null;
});

/** ย่อรูปด้วย canvas — ไม่พึ่งไลบรารีภายนอก คืนค่าเป็น Blob */
function resize(file, maxSide, quality) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? res(b) : rej(new Error('ย่อรูปไม่สำเร็จ')), 'image/jpeg', quality);
    };
    img.onerror = () => rej(new Error('อ่านไฟล์รูปไม่ได้'));
    img.src = URL.createObjectURL(file);
  });
}

function openLightbox(src) { $('#lightboxImg').src = src; $('#lightbox').hidden = false; }
$('#btnLightboxClose').addEventListener('click', () => { $('#lightbox').hidden = true; });

/* ═════════════ สแกน QR ═════════════ */

let scanStream = null, scanTimer = null, decoder = null;

const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด ' + src + ' ไม่ได้'));
  document.head.appendChild(s);
});

/**
 * Safari บน iPhone ไม่มี BarcodeDetector (WebKit ไม่เคยรองรับ)
 * จึงต้องมีตัวถอดรหัสสำรองไว้ ไม่งั้นมือถือครึ่งหนึ่งสแกนไม่ได้เลย
 * โหลด jsQR ตอนกดปุ่มสแกนครั้งแรกเท่านั้น (251 KB) ไม่ถ่วงเวลาเปิดแอป
 */
async function getDecoder() {
  if (decoder) return decoder;

  if ('BarcodeDetector' in window) {
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    decoder = {
      kind: 'native',
      async read(video) {
        const codes = await det.detect(video);
        return codes.length ? codes[0].rawValue : null;
      },
    };
    return decoder;
  }

  await loadScript('lib/jsQR.js');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  decoder = {
    kind: 'jsqr',
    read(video) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      // ย่อก่อนถอดรหัส ไม่งั้นอ่านภาพเต็มความละเอียดทุก 300ms จะหน่วงบนมือถือ
      const scale = Math.min(1, 640 / Math.max(vw, vh));
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      return code?.data || null;
    },
  };
  return decoder;
}

/**
 * เปิดกล้องสแกน QR แล้วส่งค่าที่อ่านได้ให้ผู้เรียก
 * แยกออกมาเพื่อให้ปุ่มในฟอร์มและปุ่มในหน้าค้นหาใช้ตัวเดียวกัน
 * @param {(raw:string)=>void} onResult
 */
async function openScanner(onResult) {
  $('#scanner').hidden = false;
  const msg = $('#scanMsg');
  msg.textContent = 'กำลังเตรียมตัวสแกน…';

  let dec;
  try {
    dec = await getDecoder();
  } catch (e) {
    msg.textContent = 'โหลดตัวสแกนไม่สำเร็จ — กรุณาพิมพ์เลขเอง';
    return;
  }

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    });
  } catch (err) {
    msg.textContent = err.name === 'NotAllowedError'
      ? 'ยังไม่ได้อนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องในตั้งค่าเบราว์เซอร์ แล้วลองใหม่'
      : 'เปิดกล้องไม่ได้: ' + err.name + ' — กรุณาพิมพ์เลขเอง';
    return;
  }

  const video = $('#scanVideo');
  video.srcObject = scanStream;
  video.setAttribute('playsinline', '');   // iOS จะเปิดวิดีโอเต็มจอถ้าไม่มีบรรทัดนี้
  await video.play();
  msg.textContent = 'เล็ง QR ให้อยู่ในกรอบ';

  scanTimer = setInterval(async () => {
    try {
      const raw = await dec.read(video);
      if (!raw) return;
      closeScanner();
      onResult(raw.trim());
    } catch (_) { /* เฟรมนี้อ่านไม่ออก ข้ามไป */ }
  }, 300);
}

/* ปุ่มในฟอร์ม — เติมเลขที่ใบส่งซ่อม */
$('#btnScan').addEventListener('click', () => openScanner(raw => {
  $('#fDocNo').value = raw;
  $('#fDocNo').dispatchEvent(new Event('input'));
  toast('สแกนได้: ' + raw);
}));

/* ปุ่มในหน้ารายการ — หางานจากใบซ่อม
   เจองานเดียวเปิดให้เลย เพราะกรณีใช้จริงคือหยิบใบมาสแกนเพื่อกรอกตอนปิดงาน */
$('#btnScanSearch').addEventListener('click', () => openScanner(raw => {
  clearFilters();                       // ล้างตัวกรองเดิมก่อน ไม่งั้นอาจหาไม่เจอทั้งที่มีงานอยู่
  listFilter.q = raw.toLowerCase();
  $('#listSearch').value = raw;
  renderList();

  const hits = Store.jobs.filter(j => !j.deleted &&
    [j.id, j.docNo, j.pattern, j.branch, j.defectKind, j.defectSpot, j.technician]
      .join(' ').toLowerCase().includes(listFilter.q));

  if (hits.length === 1) { openJob(hits[0].id); toast(`เปิดงาน ${hits[0].id}`); }
  else if (hits.length === 0) toast(`ไม่พบงานของ ${raw}`);
  else toast(`พบ ${hits.length} งาน`);
}));
function closeScanner() {
  clearInterval(scanTimer); scanTimer = null;
  scanStream?.getTracks().forEach(t => t.stop()); scanStream = null;
  $('#scanVideo').srcObject = null;
  $('#scanner').hidden = true;
}
$('#btnScanClose').addEventListener('click', closeScanner);

/* ═════════════ รายการ ═════════════ */

let listFilter = { q: '', status: '', from: '', to: '', tech: '' };
let drill = null;          // { label, set } เมื่อกดเข้ามาจากหน้ารายงาน

['#lFrom', '#lTo'].forEach(s => $(s).addEventListener('change', () => {
  listFilter.from = $('#lFrom').value;
  listFilter.to   = $('#lTo').value;
  syncBE(); renderList();
}));

$('#lTech').addEventListener('change', e => {
  listFilter.tech = e.target.value; renderList();
});

function clearFilters() {
  listFilter = { q: '', status: '', from: '', to: '', tech: '' };
  drill = null;
  $('#listSearch').value = '';
  $('#lFrom').value = ''; $('#lTo').value = ''; $('#lTech').value = '';
  $$('#statusFilter .pill').forEach(p => p.classList.toggle('is-on', p.dataset.status === ''));
  syncBE(); renderList();
}
$('#btnClearFilter').addEventListener('click', clearFilters);

$('#listSearch').addEventListener('input', e => {
  listFilter.q = e.target.value.trim().toLowerCase(); renderList();
});

/* กดแถวในรายงาน -> เปิดหน้ารายการที่กรองไว้แล้ว */
$('#view-report').addEventListener('click', e => {
  const el = e.target.closest('[data-drill]'); if (!el) return;
  const d = drillStore[+el.dataset.drill]; if (!d) return;
  // ล้างตัวกรองอื่นทั้งหมดก่อน ไม่งั้นจำนวนที่เห็นจะไม่ตรงกับตัวเลขที่กดมา
  clearFilters();
  drill = { label: d.label, set: new Set(d.ids) };
  showView('list');
});

function clearDrill() { drill = null; renderList(); }
$('#drillClear').addEventListener('click', clearDrill);
$('#statusFilter').addEventListener('click', e => {
  const b = e.target.closest('[data-status]'); if (!b) return;
  listFilter.status = b.dataset.status;
  $$('#statusFilter .pill').forEach(p => p.classList.toggle('is-on', p === b));
  renderList();
});

function renderList() {
  // เติมรายชื่อช่างจากงานที่มีจริง คงค่าที่เลือกไว้
  const techs = [...new Set(Store.jobs.filter(j => !j.deleted)
    .map(j => j.technician).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const cur = listFilter.tech;
  $('#lTech').innerHTML = `<option value="">ทุกช่าง</option>` +
    techs.map(t => `<option${t === cur ? ' selected' : ''}>${esc(t)}</option>`).join('') +
    `<option value="(ไม่ระบุ)"${cur === '(ไม่ระบุ)' ? ' selected' : ''}>(ยังไม่ระบุช่าง)</option>`;

  const rows = Store.jobs.filter(j => {
    if (j.deleted) return false;
    if (drill && !drill.set.has(j.id)) return false;
    if (listFilter.status && j.status !== listFilter.status) return false;
    if (listFilter.tech && (j.technician || '(ไม่ระบุ)') !== listFilter.tech) return false;
    // งานที่ไม่มีวันที่รับงานจะไม่เข้าเงื่อนไขช่วงวันที่ใด ๆ
    if (listFilter.from && (!j.dateIn || j.dateIn < listFilter.from)) return false;
    if (listFilter.to   && (!j.dateIn || j.dateIn > listFilter.to))   return false;
    if (!listFilter.q) return true;
    return [j.id, j.docNo, j.pattern, j.branch, j.defectKind, j.defectSpot, j.technician]
      .join(' ').toLowerCase().includes(listFilter.q);
  });

  $('#drillChip').hidden = !drill;
  if (drill) $('#drillLabel').textContent = `จากรายงาน: ${drill.label}`;

  const bits = [];
  const { from, to } = listFilter;
  if (from && to)      bits.push(`${thaiDate(from)} – ${thaiDate(to)}`);
  else if (from)       bits.push(`ตั้งแต่ ${thaiDate(from)}`);
  else if (to)         bits.push(`ถึง ${thaiDate(to)}`);
  if (listFilter.tech) bits.push(listFilter.tech);
  $('#listCount').textContent = `${rows.length} รายการ` + (bits.length ? ` · ${bits.join(' · ')}` : '');
  $('#btnClearFilter').hidden =
    !(drill || listFilter.q || listFilter.status || listFilter.from || listFilter.to || listFilter.tech);

  /* จำนวนต่อสถานะบนปุ่มกรอง — นับจากชุดที่ผ่านตัวกรองอื่นแล้ว
     ไม่ใช่ทั้งฐานข้อมูล ตัวเลขจะได้ตรงกับสิ่งที่จะเห็นจริงเมื่อกด */
  const preStatus = Store.jobs.filter(j => {
    if (j.deleted) return false;
    if (drill && !drill.set.has(j.id)) return false;
    if (listFilter.tech && (j.technician || '(ไม่ระบุ)') !== listFilter.tech) return false;
    if (listFilter.from && (!j.dateIn || j.dateIn < listFilter.from)) return false;
    if (listFilter.to   && (!j.dateIn || j.dateIn > listFilter.to))   return false;
    if (!listFilter.q) return true;
    return [j.id, j.docNo, j.pattern, j.branch, j.defectKind, j.defectSpot, j.technician]
      .join(' ').toLowerCase().includes(listFilter.q);
  });
  $$('#statusFilter .pill').forEach(p => {
    const s = p.dataset.status;
    const n = s ? preStatus.filter(j => j.status === s).length : preStatus.length;
    p.innerHTML = `${esc(p.dataset.status || 'ทั้งหมด')} <i>${n}</i>`;
  });

  if (!rows.length) { $('#jobList').innerHTML = `<p class="empty">ไม่พบรายการ</p>`; return; }

  /* จัดกลุ่มตามวันรับงาน — ช่างมองหางานของวันนี้เป็นหลัก */
  const today = todayISO();
  let out = '', lastDay = null;
  for (const j of rows) {
    const day = j.dateIn || '';
    if (day !== lastDay) {
      lastDay = day;
      const n = rows.filter(x => (x.dateIn || '') === day).length;
      const name = !day ? 'ไม่ระบุวันที่' : day === today ? `วันนี้ · ${thaiDate(day)}` : thaiDate(day);
      out += `<div class="day-hd">${esc(name)} <b>· ${n} งาน</b></div>`;
    }
    const d = lossOf(j);
    out += `<button type="button" class="job-row s-${esc(j.status)}" data-id="${esc(j.id)}">
      <span class="jr-1"><span class="jr-id">${esc(j.id)}</span>
      <span class="jr-main">${esc(j.pattern || '—')} <u>· ${esc(j.defectKind || '')}${j.defectSpot ? ' ' + esc(j.defectSpot) : ''}</u></span></span>
      <span class="jr-2"><span class="jr-doc">${esc(j.docNo || '—')}</span>
      <span class="jr-where">${esc(j.branch || '—')} · ${j.dateIn ? j.dateIn.slice(8) + '/' + j.dateIn.slice(5, 7) : '—'}</span>
      <span class="jr-loss">${d !== null && d > 0.005 ? d.toFixed(2) : '<span class="muted">—</span>'}</span>
      <span class="jr-st"><span class="st st-${esc(j.status)}">${esc(j.status)}</span></span></span>
    </button>`;
  }
  $('#jobList').innerHTML = out;
}
$('#jobList').addEventListener('click', e => {
  const c = e.target.closest('[data-id]'); if (c) openJob(c.dataset.id);
});

/* ═════════════ รายงาน ═════════════ */

['#rFrom', '#rTo', '#rBranch', '#rTech'].forEach(s => $(s).addEventListener('change', renderReport));

function reportRows() {
  const from = $('#rFrom').value, to = $('#rTo').value;
  const br = $('#rBranch').value, tc = $('#rTech').value;
  return Store.jobs.filter(j => {
    if (j.deleted) return false;
    if (from && (!j.dateIn || j.dateIn < from)) return false;
    if (to   && (!j.dateIn || j.dateIn > to))   return false;
    if (br && j.branch !== br) return false;
    if (tc && (j.technician || '(ไม่ระบุ)') !== tc) return false;
    return true;
  });
}

/* เก็บรายชื่องานของแต่ละแถวในรายงานไว้ เพื่อให้กดแล้วเปิดดูรายการงานจริงได้
   เก็บ id ตรง ๆ ตอนสร้างรายงาน ไม่คำนวณเงื่อนไขซ้ำตอนกด
   รายการที่เห็นจึงตรงกับตัวเลขที่นับไว้เสมอ ไม่มีทางเพี้ยน */
let drillStore = [];

function bars(entries, opts = {}) {
  if (!entries.length) return `<p class="empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`;
  const max = Math.max(...entries.map(e => Math.abs(e[1]))) || 1;
  return entries.map(([name, v, ids]) => {
    const i = ids ? drillStore.push({ label: `${opts.title || ''} ${name}`.trim(), ids }) - 1 : -1;
    return `<button type="button" class="bar-row${i >= 0 ? ' can-drill' : ''}"${i >= 0 ? ` data-drill="${i}"` : ''}>
      <span title="${esc(name)}">${esc(name)}</span>
      <span class="bar-track"><span class="bar-fill"
        style="width:${(Math.abs(v) / max * 100).toFixed(1)}%${opts.loss ? ';background:var(--bad-2)' : ''}"></span></span>
      <span class="bar-val">${opts.fmt ? opts.fmt(v) : v}</span>
    </button>`;
  }).join('');
}

/** คืน [ชื่อ, จำนวน, รายชื่อ id] เรียงจากมากไปน้อย */
const tally = (rows, keyFn) => {
  const m = new Map();
  rows.forEach(r => {
    const k = keyFn(r); if (!k) return;
    const e = m.get(k) || { n: 0, ids: [] };
    e.n++; e.ids.push(r.id); m.set(k, e);
  });
  return [...m.entries()].map(([name, e]) => [name, e.n, e.ids]).sort((a, b) => b[1] - a[1]);
};

function renderReport() {
  const keep = (el, vals, label) => {
    const cur = el.value;
    el.innerHTML = `<option value="">${label}</option>` +
      vals.map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };
  keep($('#rBranch'), [...new Set(Store.jobs.map(j => j.branch).filter(Boolean))].sort(), 'ทุกสาขา');
  keep($('#rTech'),   [...new Set(Store.jobs.map(j => j.technician || '(ไม่ระบุ)'))].sort(), 'ทุกช่าง');
  syncBE();
  drillStore = [];

  const rows = reportRows();
  const fromV = $('#rFrom').value, toV = $('#rTo').value;
  reportScope = [
    fromV || toV ? `${fromV ? thaiDate(fromV) : '…'} – ${toV ? thaiDate(toV) : '…'}` : 'ทุกช่วงเวลา',
    $('#rBranch').value || 'ทุกสาขา',
    $('#rTech').value   || 'ทุกช่าง',
  ].join(' · ');
  if (curView === 'report') paintTopbar();

  /* 1 · อาการชำรุด */
  $('#repDefects').innerHTML = bars(
    tally(rows, r => [r.defectKind, r.defectSpot].filter(Boolean).join(' ')).slice(0, 10),
    { title: 'อาการ' });

  const topPatterns = tally(rows, r => r.pattern).slice(0, 8).map(e => e[0]);
  const topKinds    = tally(rows, r => r.defectKind).slice(0, 5).map(e => e[0]);
  if (topPatterns.length && topKinds.length) {
    const cellRows = (p, k) => rows.filter(r => r.pattern === p && r.defectKind === k);
    const maxCell = Math.max(...topPatterns.flatMap(p => topKinds.map(k => cellRows(p, k).length)));
    $('#repMatrix').innerHTML =
      `<thead><tr><th>ลวดลาย</th>${topKinds.map(k => `<th>${esc(k)}</th>`).join('')}<th>รวม</th></tr></thead>
       <tbody>${topPatterns.map(p => {
         const cells = topKinds.map(k => {
           const rs = cellRows(p, k);
           if (!rs.length) return `<td class="nil">·</td>`;
           const i = drillStore.push({ label: `${p} · ${k}`, ids: rs.map(r => r.id) }) - 1;
           return `<td class="can-drill ${rs.length === maxCell ? 'hot' : ''}" data-drill="${i}">${rs.length}</td>`;
         });
         const total = topKinds.reduce((a, k) => a + cellRows(p, k).length, 0);
         return `<tr><td>${esc(p)}</td>${cells.join('')}<td><b>${total}</b></td></tr>`;
       }).join('')}</tbody>`;
  } else $('#repMatrix').innerHTML = `<tbody><tr><td>ไม่มีข้อมูล</td></tr></tbody>`;

  /* 2 · น้ำหนักสูญเสีย */
  const withLoss = rows.map(r => ({ r, d: lossOf(r) })).filter(x => x.d !== null);
  const total = withLoss.reduce((a, x) => a + Math.max(0, x.d), 0);
  const lostJobs = withLoss.filter(x => x.d > 0.005).length;
  const rejN = rows.filter(r => r.status === 'ไม่ซ่อม').length;

  /* ตัวเลขสำคัญขึ้นบนสุด ไม่ต้องเลื่อนหา (ดีไซน์ 1e) */
  $('#repKpi').innerHTML = `
    <div class="kpi"><div class="kpi-lb">งานทั้งหมด</div><div class="kpi-v">${rows.length}</div></div>
    <div class="kpi"><div class="kpi-lb">ชั่งครบ 2 ครั้ง</div><div class="kpi-v">${withLoss.length}</div></div>
    <div class="kpi bad"><div class="kpi-lb">รวมทองสูญเสีย</div><div class="kpi-v">${total.toFixed(2)} <u>ก.</u></div></div>
    <div class="kpi"><div class="kpi-lb">อัตรา Reject</div><div class="kpi-v">${
      rows.length ? (rejN / rows.length * 100).toFixed(1) : '0.0'}<u>%</u></div></div>`;

  $('#repLossTotal').innerHTML =
    `<span>งานที่ชั่งครบ 2 ครั้ง <b>${withLoss.length}</b></span>
     <span>งานที่มีการสูญเสีย <b>${lostJobs}</b></span>
     <span>รวมทองสูญเสีย <b>${total.toFixed(2)} ก.</b></span>`;

  const sumBy = keyFn => {
    const m = new Map();
    withLoss.forEach(({ r, d }) => {
      const k = keyFn(r); if (!k) return;
      const e = m.get(k) || { v: 0, ids: [] };
      e.v = +(e.v + Math.max(0, d)).toFixed(3); e.ids.push(r.id); m.set(k, e);
    });
    return [...m.entries()].map(([name, e]) => [name, e.v, e.ids]).filter(x => x[1] > 0);
  };
  const g = v => v.toFixed(2);
  // เรียงตามปีก่อนเดือน ไม่งั้น 10/2568 จะมาอยู่หลัง 08/2569
  const monthKey = r => r.dateIn ? `${r.dateIn.slice(5, 7)}/${Number(r.dateIn.slice(0, 4)) + 543}` : '';
  const monthSort = s => { const [m, y] = s.split('/'); return y + m; };
  $('#repLossMonth').innerHTML = bars(
    sumBy(monthKey).sort((a, b) => monthSort(a[0]).localeCompare(monthSort(b[0]))),
    { loss: true, fmt: g, title: 'เดือน' });
  $('#repLossMethod').innerHTML = bars(
    sumBy(r => r.method || '(ไม่ระบุ)').sort((a, b) => b[1] - a[1]),
    { loss: true, fmt: g, title: 'วิธีซ่อม' });

  /* 3 · รายช่าง */
  const techs = [...new Set(rows.map(r => r.technician || '(ไม่ระบุ)'))].sort();
  $('#repTech').innerHTML =
    `<thead><tr><th>ช่าง</th><th>รับงาน</th><th>เสร็จสิ้น</th><th>ไม่ซ่อม</th>
      <th>อัตรา Reject</th><th>ซิ (ก.)</th></tr></thead>
     <tbody>${techs.map(t => {
       const mine = rows.filter(r => (r.technician || '(ไม่ระบุ)') === t);
       const done = mine.filter(r => r.status === 'เสร็จสิ้น');
       const rej  = mine.filter(r => r.status === 'ไม่ซ่อม');
       const loss = mine.reduce((a, r) => a + Math.max(0, lossOf(r) ?? 0), 0);
       const rate = mine.length ? rej.length / mine.length * 100 : 0;
       const cell = (list, text) => {
         if (!list.length) return `<td>${text}</td>`;
         const i = drillStore.push({ label: `ช่าง ${t}`, ids: list.map(r => r.id) }) - 1;
         return `<td class="can-drill" data-drill="${i}">${text}</td>`;
       };
       return `<tr><td>${esc(t)}</td>
         ${cell(mine, mine.length)}${cell(done, done.length)}${cell(rej, rej.length)}
         <td${rate > 5 ? ' style="color:var(--bad);font-weight:700"' : ''}>${rate.toFixed(1)}%</td>
         <td>${loss.toFixed(2)}</td></tr>`;
     }).join('')}</tbody>`;
}

/* สลับหัวข้อรายงานด้วยแท็บ แทนการเลื่อนยาวทีเดียว 3 หัวข้อ (ดีไซน์ 1e) */
$('#repTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-rtab]'); if (!b) return;
  $$('.rtab').forEach(t => t.classList.toggle('is-on', t === b));
  $$('[data-rpanel]').forEach(p => { p.hidden = p.dataset.rpanel !== b.dataset.rtab; });
  $('main').scrollTop = 0;
});

/* ═════════════ ตั้งค่า ═════════════ */

function renderSettings() {
  const on = navigator.onLine;
  $('#syncInfo').innerHTML = `
    <div class="stat"><div class="stat-lb">งานในเครื่อง</div><div class="stat-v">${Store.jobs.length}</div></div>
    <div class="stat"><div class="stat-lb">รอส่งขึ้น cloud</div><div class="stat-v">${Store.pending}</div></div>
    <div class="stat${on ? ' ok' : ''}"><div class="stat-lb">สถานะ</div><div class="stat-v">${on ? 'ออนไลน์' : 'ออฟไลน์'}</div></div>
    <div class="stat"><div class="stat-lb">ผู้ใช้</div><div class="stat-v" style="font-family:inherit">${esc(me ? nameOf(me.i) : '—')}</div></div>`;

  const use = (field, v) => Store.jobs.filter(j => j[field] === v && !j.deleted).length;
  $('#listTech').innerHTML = (lists.technicians || []).map(t => {
    const off = (disabled.technicians || []).includes(t);
    return `<div class="mini-row"><span class="${off ? 'off' : ''}">${esc(t)}</span>
      <span class="used">${use('technician', t)} งาน</span>
      <button data-toggle="technicians|${esc(t)}">${off ? 'เปิดใช้' : 'ปิดใช้'}</button></div>`;
  }).join('') || '<p class="hint">ยังไม่มีช่าง</p>';

  renderUsers();
  renderListItems();
}

function renderListItems() {
  const name = $('#listPicker').value;
  const field = {
    patterns: 'pattern', productTypes: 'productType', categories: 'category', parts: 'part',
    defectKinds: 'defectKind', defectSpots: 'defectSpot', methods: 'method',
  }[name];
  $('#listItems').innerHTML = (lists[name] || []).map(v => {
    const off = (disabled[name] || []).includes(v);
    return `<div class="mini-row"><span class="${off ? 'off' : ''}">${esc(v)}</span>
      <span class="used">${Store.jobs.filter(j => j[field] === v && !j.deleted).length}</span>
      <button data-toggle="${esc(name)}|${esc(v)}">${off ? 'เปิดใช้' : 'ปิดใช้'}</button></div>`;
  }).join('') || '<p class="hint">ยังไม่มีค่าในรายการนี้</p>';
}
$('#listPicker').addEventListener('change', renderListItems);

/* ─── ชื่อผู้ใช้ (admin เท่านั้น) ─── */

function renderUsers() {
  if (!me || !isAdmin()) return;
  $('#listUsers').innerHTML = C.USERS.map((u, i) => `
    <div class="user-card">
      <div class="input-row">
        <input type="text" data-uname="${i}" maxlength="24"
               value="${esc(nameOf(i))}" aria-label="ชื่อที่แสดงของ ${esc(u.email)}">
        <button class="btn-soft" data-saveuname="${i}">บันทึก</button>
      </div>
      <div class="user-meta">${esc(u.email)} · ${(u.role || 'admin') === 'staff'
        ? 'ไม่เห็นหน้ารายงาน' : 'ผู้ดูแล · เห็นทุกหน้า'}${i === me.i ? ' · <b>กำลังใช้อยู่</b>' : ''}</div>
    </div>`).join('');
}

$('#listUsers').addEventListener('click', async e => {
  const b = e.target.closest('[data-saveuname]'); if (!b) return;
  if (!me || !isAdmin()) return;
  const i = +b.dataset.saveuname;
  const v = $(`[data-uname="${i}"]`).value.trim();
  if (!v)             return toast('ชื่อว่างไม่ได้');
  if (v === nameOf(i)) return toast('ชื่อเดิมอยู่แล้ว');
  /* เขียนทั้งชุดทุกครั้ง กันช่องว่างตอนที่ยังไม่เคยตั้งชื่อใครเลย */
  lists.userNames = C.USERS.map((_, k) => k === i ? v : nameOf(k));
  await Store.saveLists(lists, disabled);
  cacheNames();
  if (i === me.i) $('#curUser').textContent = v;
  renderSettings();
  toast(`เปลี่ยนชื่อเป็น ${v} แล้ว`);
});

$('#view-settings').addEventListener('click', async e => {
  const t = e.target.closest('[data-toggle]'); if (!t) return;
  const [name, val] = t.dataset.toggle.split('|');
  disabled[name] = disabled[name] || [];
  const i = disabled[name].indexOf(val);
  i === -1 ? disabled[name].push(val) : disabled[name].splice(i, 1);
  await Store.saveLists(lists, disabled);
  renderSettings(); refreshFormLists(readForm());
});

async function addToList(name, v) {
  if (!v || (lists[name] || []).includes(v)) return;
  lists[name] = [...(lists[name] || []), v].sort((a, b) => a.localeCompare(b, 'th'));
  await Store.saveLists(lists, disabled);
  renderSettings(); refreshFormLists(readForm());
  toast('เพิ่ม ' + v + ' แล้ว');
}
$('#btnAddTech').addEventListener('click', () => {
  const v = $('#newTech').value.trim(); $('#newTech').value = '';
  addToList('technicians', v);
});
$('#btnAddItem').addEventListener('click', () => {
  const v = $('#newItem').value.trim(); $('#newItem').value = '';
  addToList($('#listPicker').value, v);
});

/* ─── ส่งออก CSV ─── */
$('#btnExportTop').addEventListener('click', () => $('#btnExport').click());
$('#btnExport').addEventListener('click', () => {
  const cols = [
    ['id', 'ลำดับงานซ่อม'], ['dateIn', 'วันที่รับงาน'], ['dateOut', 'วันที่ปิดงาน'],
    ['status', 'สถานะ'], ['docNo', 'เลขที่ใบส่งซ่อม'], ['branch', 'สาขา'],
    ['productType', 'แผนกส่งงาน'], ['category', 'ประเภทสินค้า'],
    ['pattern', 'ลวดลาย'], ['part', 'Part'],
    ['defectKind', 'อาการชำรุด-ลักษณะ'], ['defectSpot', 'อาการชำรุด-ตำแหน่ง'],
    ['weightIn', 'น้ำหนักรับซ่อม'], ['weightOut', 'น้ำหนักส่ง'], ['weightAdd', 'นน.เติม'],
    ['__loss', 'ส่วนต่างน้ำหนัก'], ['method', 'วิธีซ่อม'], ['technician', 'ช่างผู้ซ่อม'],
    ['recordedBy', 'ผู้บันทึก'], ['notes', 'หมายเหตุ'],
  ];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = Store.jobs.filter(j => !j.deleted).map(j =>
    cols.map(([k]) => k === '__loss' ? cell(lossOf(j) ?? '')
      : k.startsWith('date') ? cell(j[k] ? thaiDate(j[k]) : '')
      : cell(j[k])).join(',')).join('\r\n');
  const csv = '﻿' + cols.map(c => cell(c[1])).join(',') + '\r\n' + body;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `บันทึกงานซ่อม_${todayISO()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('ส่งออก CSV แล้ว');
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#scanner').hidden)  closeScanner();
  if (!$('#lightbox').hidden) $('#lightbox').hidden = true;
});

/* ═════════════ เริ่มทำงาน ═════════════ */

(async function boot() {
  if (!API.isConfigured()) { $('#setup').hidden = false; return; }

  if (API.hasSession()) {
    await API.refresh();
    const email = API.user?.email;
    const u = C.USERS.find(x => x.email === email);
    if (u) return enterApp(u);            // เคยล็อกอินแล้ว เข้าได้เลย
  }
  $('#login').hidden = false;
  renderLogin();
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
