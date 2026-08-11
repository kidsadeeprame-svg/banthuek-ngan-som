/* ═════════════════════════════════════════════════════════
   บันทึกงานซ่อม — ต้นแบบ
   เก็บข้อมูลในเบราว์เซอร์เครื่องนี้เท่านั้น (localStorage + IndexedDB)
   ยังไม่ได้ต่อกับ Supabase
   ═════════════════════════════════════════════════════════ */

const KEY = 'gsr.v1';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ─────────── ค่าตั้งต้นของรายการตัวเลือก ─────────── */
const BASE_LISTS = {
  productTypes: ['MOD-96.50%', 'DDD-75.00%'],
  patterns:     [],
  parts:        [],
  defectKinds:  ['ขาด', 'ดีด', 'หัก', 'บุบ', 'หลุด', 'แตกลาย', 'ล็อคไม่แน่น', 'ด่าง', 'อื่น ๆ'],
  defectSpots:  ['ระหว่างเส้น', 'ใกล้หัวจรวด', 'ใกล้ห่วง', 'ตะขอ', 'ทั้งเส้น', 'หัวจรวด'],
  methods:      ['เชื่อมไฟ', 'เชื่อมเลเซอร์', 'เชื่อมเลเซอร์ + เชื่อมไฟ', 'หลอม', 'เป่าไฟ', 'ผลิตใหม่', 'ไม่ซ่อม'],
  technicians:  ['ช่างวัชร'],
};

const PHOTO_SLOTS = ['imgDoc', 'imgDefect', 'imgWeightIn', 'imgWeightOut', 'imgDone'];

let S = null;        // state
let me = null;       // ผู้ใช้ที่ล็อกอิน
let editing = null;  // id ของงานที่กำลังแก้ (null = งานใหม่)
let draftPhotos = {};// slot -> {thumb, view} ของงานที่กำลังกรอก

/* ═════════════ 1. เก็บ / อ่านข้อมูล ═════════════ */

function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) { try { return JSON.parse(raw); } catch (e) { console.warn(e); } }
  return seed();
}

function seed() {
  const jobs = (window.SEED_JOBS || []).map(j => ({ ...j, photos: {}, history: [], deleted: false }));
  const lists = JSON.parse(JSON.stringify(BASE_LISTS));

  // ดูดค่าที่มีอยู่จริงในข้อมูลเก่าเข้ามาเป็นตัวเลือก
  const collect = (field, target) => {
    jobs.forEach(j => {
      const v = (j[field] || '').trim();
      if (v && !lists[target].includes(v)) lists[target].push(v);
    });
    lists[target].sort((a, b) => a.localeCompare(b, 'th'));
  };
  collect('pattern', 'patterns');
  collect('part', 'parts');
  collect('productType', 'productTypes');
  collect('method', 'methods');

  const st = {
    jobs,
    lists,
    users: [
      { name: 'ผู้ใช้ 1', pin: '1234', active: true },
      { name: 'ผู้ใช้ 2', pin: '1234', active: true },
    ],
    disabled: {},   // listName -> [ค่าที่ปิดใช้]
  };
  localStorage.setItem(KEY, JSON.stringify(st));
  return st;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    toast('พื้นที่เก็บข้อมูลเต็ม — ลองล้างข้อมูลต้นแบบในหน้าตั้งค่า');
  }
}

/* รูปเก็บแยกใน IndexedDB เพราะ localStorage เล็กเกินไป */
const IDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (IDB.db) return res(IDB.db);
      const rq = indexedDB.open('gsr-photos', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('photos');
      rq.onsuccess = () => { IDB.db = rq.result; res(IDB.db); };
      rq.onerror = () => rej(rq.error);
    });
  },
  async put(key, val) {
    const db = await IDB.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  async get(key) {
    const db = await IDB.open();
    return new Promise((res, rej) => {
      const rq = db.transaction('photos', 'readonly').objectStore('photos').get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    });
  },
  async clear() {
    const db = await IDB.open();
    return new Promise(res => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').clear();
      tx.oncomplete = res;
    });
  },
};

/* ═════════════ 2. เครื่องมือทั่วไป ═════════════ */

const pad = (n, w = 4) => String(n).padStart(w, '0');

/** ISO (ค.ศ.) -> วว/ดด/ปปปป (พ.ศ.) */
function thaiDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return '—';
  return `${pad(d, 2)}/${pad(m, 2)}/${y + 543}`;
}
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ช่อง <input type="date"> ของเบราว์เซอร์แสดง ค.ศ. เสมอ แก้ไม่ได้
   จึงกำกับ พ.ศ. ไว้ที่ป้ายชื่อช่องแทน */
function syncBE() {
  $$('.be').forEach(el => {
    const v = $('#' + el.dataset.be)?.value;
    el.textContent = v ? thaiDate(v) : '';
  });
}
['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  if (e.target.type === 'date') syncBE();
}));
const beYear2  = iso => String((Number((iso || todayISO()).slice(0, 4)) + 543) % 100).padStart(2, '0');

function nextJobId() {
  const yy = beYear2(todayISO());
  const prefix = `F${yy}-`;
  const used = S.jobs
    .filter(j => j.id.startsWith(prefix))
    .map(j => Number(j.id.slice(prefix.length)) || 0);
  return prefix + pad(Math.max(0, ...used) + 1);
}

const branchOf = doc => (String(doc || '').match(/^([A-Za-z0-9]{5})-/) || [])[1] || '';

/** สูญหายจริง = (รับ + เติม) − ส่ง ; บวก = หาย */
function lossOf(j) {
  if (j.weightIn == null || j.weightOut == null) return null;
  return +((j.weightIn + (j.weightAdd || 0)) - j.weightOut).toFixed(3);
}

const activeList = name =>
  (S.lists[name] || []).filter(v => !(S.disabled[name] || []).includes(v));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function fillSelect(el, values, current, placeholder = '— เลือก —') {
  const extra = current && !values.includes(current) ? [current] : [];
  el.innerHTML =
    `<option value="">${placeholder}</option>` +
    [...values, ...extra].map(v =>
      `<option${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('') +
    `<option value="__new">➕ เพิ่มค่าใหม่…</option>`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ═════════════ 3. ล็อกอิน ═════════════ */

let pinBuf = '', pinUser = null;

function renderLogin() {
  $('#userChips').innerHTML = S.users
    .filter(u => u.active)
    .map((u, i) => `<button data-u="${i}">${esc(u.name)}</button>`)
    .join('');
  $('#loginStep1').hidden = false;
  $('#loginStep2').hidden = true;
}

function renderPin() {
  $('#pinDots').innerHTML = [0, 1, 2, 3, 4, 5]
    .slice(0, Math.max(4, pinBuf.length))
    .map(i => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join('');
}

function tryPin() {
  if (pinBuf === pinUser.pin) {
    me = pinUser;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#curUser').textContent = me.name;
    startNewJob();
    renderAll();
  } else {
    $('#pinError').hidden = false;
    pinBuf = ''; renderPin();
    setTimeout(() => { $('#pinError').hidden = true; }, 1800);
  }
}

$('#userChips').addEventListener('click', e => {
  const b = e.target.closest('[data-u]'); if (!b) return;
  pinUser = S.users.filter(u => u.active)[+b.dataset.u];
  pinBuf = '';
  $('#loginName').textContent = pinUser.name;
  $('#loginStep1').hidden = true;
  $('#loginStep2').hidden = false;
  renderPin();
});

$('.keypad').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  const k = b.dataset.k;
  if (k === 'cancel') return renderLogin();
  if (k === 'back') { pinBuf = pinBuf.slice(0, -1); return renderPin(); }
  if (pinBuf.length >= 6) return;
  pinBuf += k; renderPin();
  if (pinBuf.length >= 4) setTimeout(tryPin, 120);
});

$('#btnUser').addEventListener('click', () => {
  if (!confirm('ออกจากระบบ?')) return;
  me = null; pinBuf = '';
  $('#app').hidden = true; $('#login').hidden = false;
  renderLogin();
});

/* ═════════════ 4. สลับหน้า ═════════════ */

$('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  showView(b.dataset.view);
});

function showView(name) {
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  $$('.tab').forEach(t => t.classList.toggle('is-on', t.dataset.view === name));
  if (name === 'list')     renderList();
  if (name === 'report')   renderReport();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

$('#stepper').addEventListener('click', e => {
  const b = e.target.closest('[data-step]'); if (!b) return;
  const n = b.dataset.step;
  $$('.step').forEach(s => s.classList.toggle('is-on', s.dataset.step === n));
  $$('.step-panel').forEach(p => { p.hidden = p.dataset.panel !== n; });
});

/* ═════════════ 5. ฟอร์มบันทึกงาน ═════════════ */

const F = {
  docNo: '#fDocNo', dateIn: '#fDateIn', branch: '#fBranch',
  productType: '#fProductType', pattern: '#fPattern', part: '#fPart',
  weightIn: '#fWeightIn', defectKind: '#fDefectKind', defectSpot: '#fDefectSpot',
  status: '#fStatus', weightOut: '#fWeightOut', weightAdd: '#fWeightAdd',
  method: '#fMethod', technician: '#fTechnician', dateOut: '#fDateOut', notes: '#fNotes',
};

function refreshFormLists(j = {}) {
  fillSelect($('#fProductType'), activeList('productTypes'), j.productType);
  fillSelect($('#fPattern'),     activeList('patterns'),     j.pattern);
  fillSelect($('#fPart'),        activeList('parts'),        j.part, '— ไม่มี —');
  fillSelect($('#fDefectKind'),  activeList('defectKinds'),  j.defectKind);
  fillSelect($('#fDefectSpot'),  activeList('defectSpots'),  j.defectSpot);
  fillSelect($('#fMethod'),      activeList('methods'),      j.method);
  fillSelect($('#fTechnician'),  activeList('technicians'),  j.technician);
  $('#dlBranch').innerHTML = [...new Set(S.jobs.map(j => j.branch).filter(Boolean))]
    .sort().map(b => `<option value="${esc(b)}">`).join('');
}

/* เลือก “เพิ่มค่าใหม่…” ในกล่อง dropdown ใด ๆ */
const SELECT_LIST = {
  fProductType: 'productTypes', fPattern: 'patterns', fPart: 'parts',
  fDefectKind: 'defectKinds', fDefectSpot: 'defectSpots',
  fMethod: 'methods', fTechnician: 'technicians',
};
Object.keys(SELECT_LIST).forEach(id => {
  $('#' + id).addEventListener('change', e => {
    if (e.target.value !== '__new') return;
    const listName = SELECT_LIST[id];
    const v = (prompt('เพิ่มค่าใหม่') || '').trim();
    if (v && !S.lists[listName].includes(v)) {
      S.lists[listName].push(v);
      S.lists[listName].sort((a, b) => a.localeCompare(b, 'th'));
      save();
    }
    const keep = {}; keep[id.replace(/^f/, '').replace(/^./, c => c.toLowerCase())] = v;
    refreshFormLists(readForm());
    e.target.value = v || '';
  });
});

function startNewJob() {
  editing = null; draftPhotos = {};
  $('#formTitle').textContent = 'งานซ่อมใหม่';
  $('#formJobId').textContent = nextJobId();
  $('#btnCancelEdit').hidden = true;
  Object.values(F).forEach(sel => { const el = $(sel); if (el) el.value = ''; });
  $('#fDateIn').value = todayISO();
  $('#fStatus').value = 'รับงาน';
  refreshFormLists({});
  renderPhotoSlots({});
  updateDiff();
  syncBE();
  $('#branchHint').textContent = '';
  $('#formError').hidden = true;
  $$('.step')[0].click();
}

function openJob(id) {
  const j = S.jobs.find(x => x.id === id); if (!j) return;
  editing = id; draftPhotos = {};
  $('#formTitle').textContent = 'แก้ไขงานซ่อม';
  $('#formJobId').textContent = j.id;
  $('#btnCancelEdit').hidden = false;
  refreshFormLists(j);
  Object.entries(F).forEach(([k, sel]) => {
    const el = $(sel); if (el) el.value = j[k] ?? '';
  });
  $('#branchHint').textContent = j.branch ? `สาขา ${j.branch}` : '';
  renderPhotoSlots(j.photos || {}, j);
  updateDiff();
  syncBE();
  $('#formError').hidden = true;
  showView('form');
  $$('.step')[0].click();
}

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

/* เติมสาขาอัตโนมัติจากเลขที่ใบส่งซ่อม */
$('#fDocNo').addEventListener('input', e => {
  const b = branchOf(e.target.value);
  if (b) {
    if (!$('#fBranch').value || $('#fBranch').dataset.auto === '1') {
      $('#fBranch').value = b;
      $('#fBranch').dataset.auto = '1';
    }
    $('#branchHint').textContent = `เติมสาขา ${b} ให้อัตโนมัติ — แก้ได้`;
  } else {
    $('#branchHint').textContent = e.target.value
      ? 'แกะสาขาจากเลขนี้ไม่ได้ — กรอกสาขาเอง' : '';
  }
});
$('#fBranch').addEventListener('input', e => { e.target.dataset.auto = '0'; });

['#fWeightIn', '#fWeightOut', '#fWeightAdd'].forEach(s =>
  $(s).addEventListener('input', updateDiff));

function updateDiff() {
  const f = readForm();
  const box = $('#diffBox'), val = $('#diffValue');
  const d = lossOf(f);
  if (d === null) { box.hidden = true; return; }
  box.hidden = false;
  val.className = 'diff-value ' + (d > 0.005 ? 'bad' : 'ok');
  val.textContent = d > 0 ? `− ${d.toFixed(2)} ก. (หาย)`
                  : d < 0 ? `+ ${Math.abs(d).toFixed(2)} ก. (เกิน)`
                          : '0.00 ก. (ครบ)';
}

$('#fStatus').addEventListener('change', e => {
  if (e.target.value === 'เสร็จสิ้น' && !$('#fDateOut').value)
    $('#fDateOut').value = todayISO();
});

/* ─── ตรวจความครบถ้วน ─── */
function validate(f) {
  const bad = [];
  if (!f.docNo.trim())  bad.push('เลขที่ใบส่งซ่อม');
  if (f.weightIn == null) bad.push('น้ำหนักรับซ่อม');
  if (!f.productType)   bad.push('ประเภทสินค้า');
  if (!f.pattern)       bad.push('ลวดลาย');
  if (!f.defectKind)    bad.push('อาการชำรุด — ลักษณะ');
  if (!f.defectSpot)    bad.push('อาการชำรุด — ตำแหน่ง');
  const hasDefectImg = draftPhotos.imgDefect ||
    (editing && S.jobs.find(j => j.id === editing)?.photos?.imgDefect) ||
    (editing && S.jobs.find(j => j.id === editing)?.imgDefect);
  if (!hasDefectImg) bad.push('ภาพชำรุด');

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

  const id = editing || nextJobId();
  const stamp = { by: me.name, at: new Date().toISOString() };

  // เขียนรูปที่เพิ่งถ่ายลง IndexedDB
  const photos = editing ? { ...(S.jobs.find(j => j.id === editing).photos || {}) } : {};
  for (const [slot, data] of Object.entries(draftPhotos)) {
    if (data === null) { delete photos[slot]; continue; }
    const key = `${id}:${slot}`;
    await IDB.put(key, data);
    photos[slot] = key;
  }

  if (editing) {
    const j = S.jobs.find(x => x.id === editing);
    const changes = Object.keys(F).filter(k => String(j[k] ?? '') !== String(f[k] ?? ''));
    Object.assign(j, f, { branch: f.branch || branchOf(f.docNo), photos });
    if (changes.length) j.history.push({ ...stamp, action: 'แก้ไข', fields: changes });
    toast('บันทึกการแก้ไขแล้ว');
  } else {
    S.jobs.unshift({
      id, ...f,
      branch: f.branch || branchOf(f.docNo),
      recordedBy: me.name,
      photos, legacy: false, deleted: false,
      history: [{ ...stamp, action: 'สร้าง' }],
    });
    toast(`บันทึก ${id} แล้ว`);
  }
  save();
  startNewJob();
});

$('#btnCancelEdit').addEventListener('click', startNewJob);

/* ═════════════ 6. รูปถ่าย ═════════════ */

const SLOT_LABEL = {
  imgDoc: 'ใบส่งซ่อม', imgDefect: 'ภาพชำรุด', imgWeightIn: 'ชั่งตอนรับ',
  imgWeightOut: 'ชั่งตอนส่ง', imgDone: 'งานเสร็จ',
};

async function renderPhotoSlots(photos, job) {
  for (const slot of PHOTO_SLOTS) {
    const el = $(`.photo-slot[data-slot="${slot}"]`); if (!el) continue;
    const draft = draftPhotos[slot];
    let thumb = null, legacyName = '';

    if (draft) thumb = draft.thumb;
    else if (draft !== null && photos[slot]) {
      const rec = await IDB.get(photos[slot]);
      thumb = rec?.thumb || null;
    }
    if (!thumb && job && job[slot] && job.legacy) legacyName = job[slot];

    el.classList.toggle('has-img', !!thumb);
    el.classList.toggle('legacy', !thumb && !!legacyName);
    el.innerHTML = thumb
      ? `<img src="${thumb}" alt=""><button class="rm" data-rm="${slot}">✕</button>`
      : legacyName
        ? `<span>${esc(SLOT_LABEL[slot])}<br>📁 ${esc(legacyName)}</span>`
        : `<span>${esc(SLOT_LABEL[slot])}${slot === 'imgDefect' ? ' <i class="req">*</i>' : ''}</span>`;
  }
}

let pickingSlot = null;
document.addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    draftPhotos[rm.dataset.rm] = null;
    const j = editing ? S.jobs.find(x => x.id === editing) : null;
    renderPhotoSlots(j?.photos || {}, j);
    return;
  }
  const slot = e.target.closest('.photo-slot');
  if (slot) {
    const key = slot.dataset.slot;
    const cur = draftPhotos[key];
    if (cur?.view) return openLightbox(cur.view);
    pickingSlot = key;
    $('#filePicker').click();
  }
});

$('#filePicker').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !pickingSlot) return;
  toast('กำลังย่อรูป…');
  const [view, thumb] = await Promise.all([resize(file, 1280, .75), resize(file, 400, .7)]);
  draftPhotos[pickingSlot] = { view, thumb };
  const j = editing ? S.jobs.find(x => x.id === editing) : null;
  await renderPhotoSlots(j?.photos || {}, j);
  toast(`เพิ่ม${SLOT_LABEL[pickingSlot]}แล้ว`);
  pickingSlot = null;
});

/** ย่อรูปด้วย canvas — ไม่ต้องพึ่งไลบรารีภายนอก */
function resize(file, maxSide, quality) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

function openLightbox(src) {
  $('#lightboxImg').src = src;
  $('#lightbox').hidden = false;
}
$('#btnLightboxClose').addEventListener('click', () => { $('#lightbox').hidden = true; });

/* ═════════════ 7. สแกน QR ═════════════ */

let scanStream = null, scanTimer = null;

$('#btnScan').addEventListener('click', async () => {
  $('#scanner').hidden = false;
  const msg = $('#scanMsg');

  if (!('BarcodeDetector' in window)) {
    msg.textContent = 'เบราว์เซอร์นี้สแกน QR ไม่ได้ — กรุณาพิมพ์เลขเอง';
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
  } catch (err) {
    msg.textContent = 'เปิดกล้องไม่ได้: ' + err.name + ' — กรุณาพิมพ์เลขเอง';
    return;
  }

  const video = $('#scanVideo');
  video.srcObject = scanStream;
  await video.play();
  msg.textContent = 'เล็ง QR ให้อยู่ในกรอบ';

  const det = new BarcodeDetector({ formats: ['qr_code'] });
  scanTimer = setInterval(async () => {
    try {
      const codes = await det.detect(video);
      if (codes.length) {
        const raw = codes[0].rawValue.trim();
        closeScanner();
        $('#fDocNo').value = raw;
        $('#fDocNo').dispatchEvent(new Event('input'));
        toast('สแกนได้: ' + raw);
      }
    } catch (_) { /* เฟรมนี้อ่านไม่ออก ข้ามไป */ }
  }, 350);
});

function closeScanner() {
  clearInterval(scanTimer); scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  $('#scanVideo').srcObject = null;
  $('#scanner').hidden = true;
}
$('#btnScanClose').addEventListener('click', closeScanner);

/* ═════════════ 8. หน้ารายการ ═════════════ */

let listFilter = { q: '', status: '' };

$('#listSearch').addEventListener('input', e => {
  listFilter.q = e.target.value.trim().toLowerCase();
  renderList();
});
$('#statusFilter').addEventListener('click', e => {
  const b = e.target.closest('[data-status]'); if (!b) return;
  listFilter.status = b.dataset.status;
  $$('#statusFilter .pill').forEach(p => p.classList.toggle('is-on', p === b));
  renderList();
});

function visibleJobs() {
  return S.jobs.filter(j => {
    if (j.deleted) return false;
    if (listFilter.status && j.status !== listFilter.status) return false;
    if (!listFilter.q) return true;
    return [j.id, j.docNo, j.pattern, j.branch, j.defectKind, j.defectSpot, j.technician]
      .join(' ').toLowerCase().includes(listFilter.q);
  });
}

function renderList() {
  const rows = visibleJobs();
  $('#listCount').textContent = `${rows.length} รายการ`;
  $('#jobList').innerHTML = rows.length ? rows.map(j => {
    const d = lossOf(j);
    return `<div class="job-card" data-id="${esc(j.id)}">
      <div class="job-card-top">
        <span class="job-card-id">${esc(j.id)}</span>
        <span class="badge s-${esc(j.status)}">${esc(j.status)}</span>
      </div>
      <div class="job-card-main">${esc(j.pattern || '—')} · ${esc(j.defectKind)}${j.defectSpot ? ' ' + esc(j.defectSpot) : ''}</div>
      <div class="job-card-sub">
        <span>${esc(j.docNo || '—')}</span>
        <span>${esc(j.branch || '—')}</span>
        <span>${thaiDate(j.dateIn)}</span>
        ${d !== null && d > 0.005 ? `<span style="color:var(--bad)">หาย ${d.toFixed(2)} ก.</span>` : ''}
      </div>
    </div>`;
  }).join('') : `<p class="empty">ไม่พบรายการ</p>`;
}

$('#jobList').addEventListener('click', e => {
  const c = e.target.closest('[data-id]'); if (c) openJob(c.dataset.id);
});

/* ═════════════ 9. หน้ารายงาน ═════════════ */

['#rFrom', '#rTo', '#rBranch', '#rTech'].forEach(s =>
  $(s).addEventListener('change', renderReport));

function reportRows() {
  const from = $('#rFrom').value, to = $('#rTo').value;
  const br = $('#rBranch').value, tc = $('#rTech').value;
  return S.jobs.filter(j => {
    if (j.deleted) return false;
    if (from && (!j.dateIn || j.dateIn < from)) return false;
    if (to   && (!j.dateIn || j.dateIn > to))   return false;
    if (br && j.branch !== br) return false;
    if (tc && (j.technician || '(ไม่ระบุ)') !== tc) return false;
    return true;
  });
}

function bars(entries, opts = {}) {
  if (!entries.length) return `<p class="empty">ไม่มีข้อมูลในช่วงที่เลือก</p>`;
  const max = Math.max(...entries.map(e => Math.abs(e[1]))) || 1;
  return entries.map(([name, v]) => `
    <div class="bar-row">
      <span class="bar-name" title="${esc(name)}">${esc(name)}</span>
      <span class="bar-track"><span class="bar-fill ${opts.loss ? 'loss' : ''}"
        style="width:${(Math.abs(v) / max * 100).toFixed(1)}%"></span></span>
      <span class="bar-val">${opts.fmt ? opts.fmt(v) : v}</span>
    </div>`).join('');
}

const tally = (rows, keyFn) => {
  const m = new Map();
  rows.forEach(r => { const k = keyFn(r); if (k) m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

function renderReport() {
  // เติมตัวกรอง (ครั้งเดียวพอ แต่ทำซ้ำได้ ไม่เสียหาย)
  const keep = (el, vals, label) => {
    const cur = el.value;
    el.innerHTML = `<option value="">${label}</option>` +
      vals.map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };
  keep($('#rBranch'), [...new Set(S.jobs.map(j => j.branch).filter(Boolean))].sort(), 'ทุกสาขา');
  keep($('#rTech'),   [...new Set(S.jobs.map(j => j.technician || '(ไม่ระบุ)'))].sort(), 'ทุกช่าง');

  syncBE();
  const rows = reportRows();
  $('#reportScope').textContent = `${rows.length} งาน ในเงื่อนไขที่เลือก`;

  /* ── 1 · อาการชำรุด ── */
  const defects = tally(rows, r => [r.defectKind, r.defectSpot].filter(Boolean).join(' '));
  $('#repDefects').innerHTML = bars(defects.slice(0, 10), { fmt: v => v });

  const topPatterns = tally(rows, r => r.pattern).slice(0, 8).map(e => e[0]);
  const topKinds    = tally(rows, r => r.defectKind).slice(0, 5).map(e => e[0]);
  if (topPatterns.length && topKinds.length) {
    const cell = (p, k) => rows.filter(r => r.pattern === p && r.defectKind === k).length;
    const maxCell = Math.max(...topPatterns.flatMap(p => topKinds.map(k => cell(p, k))));
    $('#repMatrix').innerHTML =
      `<thead><tr><th>ลวดลาย</th>${topKinds.map(k => `<th>${esc(k)}</th>`).join('')}<th>รวม</th></tr></thead>
       <tbody>${topPatterns.map(p => {
         const cells = topKinds.map(k => cell(p, k));
         return `<tr><td>${esc(p)}</td>${cells.map(c =>
           `<td class="${c && c === maxCell ? 'hot' : ''}">${c || '·'}</td>`).join('')}
           <td><b>${cells.reduce((a, b) => a + b, 0)}</b></td></tr>`;
       }).join('')}</tbody>`;
  } else {
    $('#repMatrix').innerHTML = `<tbody><tr><td>ไม่มีข้อมูล</td></tr></tbody>`;
  }

  /* ── 2 · น้ำหนักสูญหาย ── */
  const withLoss = rows.map(r => ({ r, d: lossOf(r) })).filter(x => x.d !== null);
  const totalLoss = withLoss.reduce((a, x) => a + Math.max(0, x.d), 0);
  const lostJobs  = withLoss.filter(x => x.d > 0.005).length;
  $('#repLossTotal').innerHTML = `
    <div><b>${withLoss.length}</b><span>งานที่ชั่งครบ 2 ครั้ง</span></div>
    <div><b style="color:var(--bad)">${totalLoss.toFixed(2)} ก.</b><span>รวมทองสูญหาย</span></div>
    <div><b>${lostJobs}</b><span>งานที่มีการสูญหาย</span></div>`;

  const sumBy = keyFn => {
    const m = new Map();
    withLoss.forEach(({ r, d }) => {
      const k = keyFn(r); if (!k) return;
      m.set(k, +((m.get(k) || 0) + Math.max(0, d)).toFixed(3));
    });
    return [...m.entries()].filter(e => e[1] > 0);
  };
  const g = v => v.toFixed(2);
  $('#repLossMonth').innerHTML = bars(
    sumBy(r => r.dateIn ? `${r.dateIn.slice(5, 7)}/${Number(r.dateIn.slice(0, 4)) + 543}` : '')
      .sort((a, b) => a[0].localeCompare(b[0])), { loss: true, fmt: g });
  $('#repLossMethod').innerHTML = bars(
    sumBy(r => r.method || '(ไม่ระบุ)').sort((a, b) => b[1] - a[1]), { loss: true, fmt: g });

  /* ── 3 · ผลงานรายช่าง ── */
  const techs = [...new Set(rows.map(r => r.technician || '(ไม่ระบุ)'))].sort();
  $('#repTech').innerHTML =
    `<thead><tr><th>ช่าง</th><th>รับงาน</th><th>เสร็จสิ้น</th><th>ไม่ซ่อม</th>
      <th>อัตรา Reject</th><th>ทองหาย (ก.)</th></tr></thead>
     <tbody>${techs.map(t => {
       const mine = rows.filter(r => (r.technician || '(ไม่ระบุ)') === t);
       const done = mine.filter(r => r.status === 'เสร็จสิ้น').length;
       const rej  = mine.filter(r => r.status === 'ไม่ซ่อม').length;
       const loss = mine.reduce((a, r) => a + Math.max(0, lossOf(r) ?? 0), 0);
       const rate = mine.length ? (rej / mine.length * 100) : 0;
       return `<tr><td>${esc(t)}</td><td>${mine.length}</td><td>${done}</td><td>${rej}</td>
         <td${rate > 5 ? ' style="color:var(--bad);font-weight:700"' : ''}>${rate.toFixed(1)}%</td>
         <td>${loss.toFixed(2)}</td></tr>`;
     }).join('')}</tbody>`;
}

/* ═════════════ 10. หน้าตั้งค่า ═════════════ */

function renderSettings() {
  $('#listUsers').innerHTML = S.users.map((u, i) => `
    <div class="mini-row">
      <span class="${u.active ? '' : 'off'}">${esc(u.name)}</span>
      <button data-user-toggle="${i}">${u.active ? 'ปิดใช้' : 'เปิดใช้'}</button>
    </div>`).join('');

  const techUse = n => S.jobs.filter(j => j.technician === n && !j.deleted).length;
  $('#listTech').innerHTML = (S.lists.technicians || []).map(t => {
    const off = (S.disabled.technicians || []).includes(t);
    return `<div class="mini-row">
      <span class="${off ? 'off' : ''}">${esc(t)}</span>
      <span class="used">${techUse(t)} งาน</span>
      <button data-toggle="technicians|${esc(t)}">${off ? 'เปิดใช้' : 'ปิดใช้'}</button>
    </div>`;
  }).join('') || '<p class="hint">ยังไม่มีช่าง</p>';

  renderListItems();
}

function renderListItems() {
  const name = $('#listPicker').value;
  const field = {
    patterns: 'pattern', productTypes: 'productType', parts: 'part',
    defectKinds: 'defectKind', defectSpots: 'defectSpot', methods: 'method',
  }[name];
  const use = v => S.jobs.filter(j => j[field] === v && !j.deleted).length;
  $('#listItems').innerHTML = (S.lists[name] || []).map(v => {
    const off = (S.disabled[name] || []).includes(v);
    return `<div class="mini-row">
      <span class="${off ? 'off' : ''}">${esc(v)}</span>
      <span class="used">${use(v)}</span>
      <button data-toggle="${esc(name)}|${esc(v)}">${off ? 'เปิดใช้' : 'ปิดใช้'}</button>
    </div>`;
  }).join('') || '<p class="hint">ยังไม่มีค่าในรายการนี้</p>';
}
$('#listPicker').addEventListener('change', renderListItems);

$('#view-settings').addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const [name, val] = t.dataset.toggle.split('|');
    S.disabled[name] = S.disabled[name] || [];
    const i = S.disabled[name].indexOf(val);
    i === -1 ? S.disabled[name].push(val) : S.disabled[name].splice(i, 1);
    save(); renderSettings(); refreshFormLists(readForm());
    return;
  }
  const u = e.target.closest('[data-user-toggle]');
  if (u) {
    const usr = S.users[+u.dataset.userToggle];
    if (usr === me) return toast('ปิดใช้ผู้ใช้ที่กำลังล็อกอินอยู่ไม่ได้');
    usr.active = !usr.active;
    save(); renderSettings();
    return;
  }
  const add = e.target.closest('[data-add]');
  if (add) {
    const which = add.dataset.add;
    const input = which === 'users' ? $('#newUser') : $('#newTech');
    const v = input.value.trim(); if (!v) return;
    if (which === 'users') S.users.push({ name: v, pin: '1234', active: true });
    else if (!S.lists.technicians.includes(v)) S.lists.technicians.push(v);
    input.value = ''; save(); renderSettings(); refreshFormLists(readForm());
    toast('เพิ่ม ' + v + ' แล้ว');
  }
});

$('#btnAddItem').addEventListener('click', () => {
  const name = $('#listPicker').value;
  const v = $('#newItem').value.trim(); if (!v) return;
  if (!S.lists[name].includes(v)) {
    S.lists[name].push(v);
    S.lists[name].sort((a, b) => a.localeCompare(b, 'th'));
  }
  $('#newItem').value = ''; save(); renderListItems(); refreshFormLists(readForm());
  toast('เพิ่ม ' + v + ' แล้ว');
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
  const body = S.jobs.filter(j => !j.deleted).map(j =>
    cols.map(([k]) =>
      k === '__loss' ? cell(lossOf(j) ?? '')
      : k.startsWith('date') ? cell(thaiDate(j[k]).replace('—', ''))
      : cell(j[k])).join(',')).join('\r\n');

  const csv = '﻿' + cols.map(c => cell(c[1])).join(',') + '\r\n' + body;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `บันทึกงานซ่อม_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('ส่งออก CSV แล้ว');
});

$('#btnReset').addEventListener('click', async () => {
  if (!confirm('ล้างข้อมูลทั้งหมดในต้นแบบ แล้วโหลดข้อมูลเก่า 123 แถวใหม่?')) return;
  localStorage.removeItem(KEY);
  await IDB.clear();
  location.reload();
});

/* ═════════════ 11. เริ่มทำงาน ═════════════ */

function renderAll() { renderList(); renderReport(); renderSettings(); }

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#scanner').hidden)  closeScanner();
  if (!$('#lightbox').hidden) $('#lightbox').hidden = true;
});

S = load();
renderLogin();
