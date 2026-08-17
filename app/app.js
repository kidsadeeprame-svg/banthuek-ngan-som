/* ═══════════════════════════════════════════════════════════
   บันทึกงานซ่อม — หน้าจอ
   ข้อมูลผ่าน Store (เครื่อง) → Supabase (cloud)
   ═══════════════════════════════════════════════════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const C  = window.CONFIG;

const DEFAULT_LISTS = {
  productTypes: ['MOD-96.50%', 'DDD-75.00%'],
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
    .map((u, i) => `<button data-u="${i}">${esc(u.name)}</button>`).join('');
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
  $('#loginName').textContent = pinUser.name;
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
  $('#curUser').textContent = me.name;

  const boot = await Store.boot();
  lists = boot.lists || JSON.parse(JSON.stringify(DEFAULT_LISTS));
  disabled = boot.disabled || {};

  paintSync();
  startNewJob();
  refreshAll();

  const r = await doSync(false);
  if (r === 'ok' && !boot.lists) await Store.saveLists(lists, disabled);  // ครั้งแรกสุด
  lists = Store.lists || lists;
  disabled = Store.disabled || disabled;
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

$('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (b) showView(b.dataset.view);
});

function showView(name) {
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  $$('.tab').forEach(t => t.classList.toggle('is-on', t.dataset.view === name));
  if (name === 'list')     renderList();
  if (name === 'report')   renderReport();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
const refreshAll = () => { renderList(); renderReport(); renderSettings(); refreshFormLists(readForm()); };

$('#stepper').addEventListener('click', e => {
  const b = e.target.closest('[data-step]'); if (!b) return;
  $$('.step').forEach(s => s.classList.toggle('is-on', s === b));
  $$('.step-panel').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.step; });
});

/* ═════════════ ฟอร์ม ═════════════ */

const F = {
  docNo: '#fDocNo', dateIn: '#fDateIn', branch: '#fBranch',
  productType: '#fProductType', pattern: '#fPattern', part: '#fPart',
  weightIn: '#fWeightIn', defectKind: '#fDefectKind', defectSpot: '#fDefectSpot',
  status: '#fStatus', weightOut: '#fWeightOut', weightAdd: '#fWeightAdd',
  method: '#fMethod', technician: '#fTechnician', dateOut: '#fDateOut', notes: '#fNotes',
};
const SELECT_LIST = {
  fProductType: 'productTypes', fPattern: 'patterns', fPart: 'parts',
  fDefectKind: 'defectKinds', fDefectSpot: 'defectSpots',
  fMethod: 'methods', fTechnician: 'technicians',
};

function refreshFormLists(j = {}) {
  fillSelect($('#fProductType'), activeList('productTypes'), j.productType);
  fillSelect($('#fPattern'),     activeList('patterns'),     j.pattern);
  fillSelect($('#fPart'),        activeList('parts'),        j.part, '— ไม่มี —');
  fillSelect($('#fDefectKind'),  activeList('defectKinds'),  j.defectKind);
  fillSelect($('#fDefectSpot'),  activeList('defectSpots'),  j.defectSpot);
  fillSelect($('#fMethod'),      activeList('methods'),      j.method);
  fillSelect($('#fTechnician'),  activeList('technicians'),  j.technician);
  $('#dlBranch').innerHTML = [...new Set(Store.jobs.map(x => x.branch).filter(Boolean))]
    .sort().map(b => `<option value="${esc(b)}">`).join('');
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
});
$('#fBranch').addEventListener('input', e => { e.target.dataset.auto = '0'; });

['#fWeightIn', '#fWeightOut', '#fWeightAdd'].forEach(s => $(s).addEventListener('input', updateDiff));

function updateDiff() {
  const d = lossOf(readForm());
  const box = $('#diffBox'), val = $('#diffValue');
  if (d === null) { box.hidden = true; return; }
  box.hidden = false;
  val.className = 'diff-value ' + (d > 0.005 ? 'bad' : 'ok');
  val.textContent = d > 0 ? `− ${d.toFixed(2)} ก. (หาย)`
                  : d < 0 ? `+ ${Math.abs(d).toFixed(2)} ก. (เกิน)` : '0.00 ก. (ครบ)';
}

$('#fStatus').addEventListener('change', e => {
  if (e.target.value === 'เสร็จสิ้น' && !$('#fDateOut').value) {
    $('#fDateOut').value = todayISO(); syncBE();
  }
});

function startNewJob() {
  editing = null; draftPhotos = {};
  $('#formTitle').textContent = 'งานซ่อมใหม่';
  $('#formJobId').textContent = nextJobId();
  $('#btnCancelEdit').hidden = true;
  Object.values(F).forEach(sel => { const el = $(sel); if (el) el.value = ''; });
  $('#fDateIn').value = todayISO();
  $('#fStatus').value = 'รับงาน';
  $('#fBranch').dataset.auto = '1';
  refreshFormLists({});
  renderPhotoSlots(null);
  updateDiff(); syncBE();
  $('#branchHint').textContent = '';
  $('#formError').hidden = true;
  $$('.step')[0].click();
}

function openJob(id) {
  const j = Store.jobs.find(x => x.id === id); if (!j) return;
  editing = id; draftPhotos = {};
  $('#formTitle').textContent = 'แก้ไขงานซ่อม';
  $('#formJobId').textContent = j.id;
  $('#btnCancelEdit').hidden = false;
  refreshFormLists(j);
  Object.entries(F).forEach(([k, sel]) => { const el = $(sel); if (el) el.value = j[k] ?? ''; });
  $('#fBranch').dataset.auto = '0';
  $('#branchHint').textContent = j.branch ? `สาขา ${j.branch}` : '';
  renderPhotoSlots(j);
  updateDiff(); syncBE();
  $('#formError').hidden = true;
  showView('form');
  $$('.step')[0].click();
}
$('#btnCancelEdit').addEventListener('click', startNewJob);

function validate(f) {
  const bad = [];
  if (!f.docNo.trim())    bad.push('เลขที่ใบส่งซ่อม');
  if (f.weightIn == null) bad.push('น้ำหนักรับซ่อม');
  if (!f.productType)     bad.push('ประเภทสินค้า');
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

$('#btnScan').addEventListener('click', async () => {
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
      $('#fDocNo').value = raw.trim();
      $('#fDocNo').dispatchEvent(new Event('input'));
      toast('สแกนได้: ' + raw.trim());
    } catch (_) { /* เฟรมนี้อ่านไม่ออก ข้ามไป */ }
  }, 300);
});
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
  if (listFilter.from || listFilter.to) bits.push(`${thaiDate(listFilter.from)} – ${thaiDate(listFilter.to)}`);
  if (listFilter.tech) bits.push(listFilter.tech);
  $('#listCount').textContent = `${rows.length} รายการ` + (bits.length ? ` · ${bits.join(' · ')}` : '');
  $('#btnClearFilter').hidden =
    !(drill || listFilter.q || listFilter.status || listFilter.from || listFilter.to || listFilter.tech);
  $('#jobList').innerHTML = rows.length ? rows.map(j => {
    const d = lossOf(j);
    return `<div class="job-card" data-id="${esc(j.id)}">
      <div class="job-card-top">
        <span class="job-card-id">${esc(j.id)}</span>
        <span class="badge s-${esc(j.status)}">${esc(j.status)}</span>
      </div>
      <div class="job-card-main">${esc(j.pattern || '—')} · ${esc(j.defectKind)}${j.defectSpot ? ' ' + esc(j.defectSpot) : ''}</div>
      <div class="job-card-sub">
        <span>${esc(j.docNo || '—')}</span><span>${esc(j.branch || '—')}</span>
        <span>${thaiDate(j.dateIn)}</span>
        ${d !== null && d > 0.005 ? `<span style="color:var(--bad)">หาย ${d.toFixed(2)} ก.</span>` : ''}
      </div></div>`;
  }).join('') : `<p class="empty">ไม่พบรายการ</p>`;
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
    return `<div class="bar-row${i >= 0 ? ' can-drill' : ''}"${i >= 0 ? ` data-drill="${i}"` : ''}>
      <span class="bar-name" title="${esc(name)}">${esc(name)}</span>
      <span class="bar-track"><span class="bar-fill ${opts.loss ? 'loss' : ''}"
        style="width:${(Math.abs(v) / max * 100).toFixed(1)}%"></span></span>
      <span class="bar-val">${opts.fmt ? opts.fmt(v) : v}</span>
    </div>`;
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
  $('#reportScope').textContent = `${rows.length} งาน ในเงื่อนไขที่เลือก · กดที่แถวใดก็ได้เพื่อดูรายการงาน`;

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
           if (!rs.length) return `<td>·</td>`;
           const i = drillStore.push({ label: `${p} · ${k}`, ids: rs.map(r => r.id) }) - 1;
           return `<td class="can-drill ${rs.length === maxCell ? 'hot' : ''}" data-drill="${i}">${rs.length}</td>`;
         });
         const total = topKinds.reduce((a, k) => a + cellRows(p, k).length, 0);
         return `<tr><td>${esc(p)}</td>${cells.join('')}<td><b>${total}</b></td></tr>`;
       }).join('')}</tbody>`;
  } else $('#repMatrix').innerHTML = `<tbody><tr><td>ไม่มีข้อมูล</td></tr></tbody>`;

  /* 2 · น้ำหนักสูญหาย */
  const withLoss = rows.map(r => ({ r, d: lossOf(r) })).filter(x => x.d !== null);
  const total = withLoss.reduce((a, x) => a + Math.max(0, x.d), 0);
  const lostJobs = withLoss.filter(x => x.d > 0.005).length;
  $('#repLossTotal').innerHTML = `
    <div><b>${withLoss.length}</b><span>งานที่ชั่งครบ 2 ครั้ง</span></div>
    <div><b style="color:var(--bad)">${total.toFixed(2)} ก.</b><span>รวมทองสูญหาย</span></div>
    <div><b>${lostJobs}</b><span>งานที่มีการสูญหาย</span></div>`;

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

/* ═════════════ ตั้งค่า ═════════════ */

function renderSettings() {
  $('#syncInfo').innerHTML = `
    <div class="mini-row"><span>ผู้ใช้</span><span class="used">${esc(me?.name || '—')}</span></div>
    <div class="mini-row"><span>งานในเครื่อง</span><span class="used">${Store.jobs.length}</span></div>
    <div class="mini-row"><span>รอส่งขึ้น cloud</span><span class="used">${Store.pending}</span></div>
    <div class="mini-row"><span>สถานะ</span><span class="used">${navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์'}</span></div>`;

  const use = (field, v) => Store.jobs.filter(j => j[field] === v && !j.deleted).length;
  $('#listTech').innerHTML = (lists.technicians || []).map(t => {
    const off = (disabled.technicians || []).includes(t);
    return `<div class="mini-row"><span class="${off ? 'off' : ''}">${esc(t)}</span>
      <span class="used">${use('technician', t)} งาน</span>
      <button data-toggle="technicians|${esc(t)}">${off ? 'เปิดใช้' : 'ปิดใช้'}</button></div>`;
  }).join('') || '<p class="hint">ยังไม่มีช่าง</p>';

  renderListItems();
}

function renderListItems() {
  const name = $('#listPicker').value;
  const field = {
    patterns: 'pattern', productTypes: 'productType', parts: 'part',
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
$('#btnExport').addEventListener('click', () => {
  const cols = [
    ['id', 'ลำดับงานซ่อม'], ['dateIn', 'วันที่รับงาน'], ['dateOut', 'วันที่ปิดงาน'],
    ['status', 'สถานะ'], ['docNo', 'เลขที่ใบส่งซ่อม'], ['branch', 'สาขา'],
    ['productType', 'ประเภทสินค้า'], ['pattern', 'ลวดลาย'], ['part', 'Part'],
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
