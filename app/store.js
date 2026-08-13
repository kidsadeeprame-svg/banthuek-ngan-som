/* ═══════════════════════════════════════════════════════════
   ที่เก็บข้อมูลฝั่งเครื่อง + คิวรอส่ง
   หลักการ: เขียนลงเครื่องก่อนเสมอ แล้วค่อยส่งขึ้น cloud
            เน็ตหลุดก็บันทึกงานได้ปกติ ไม่มีข้อมูลหาย
   ═══════════════════════════════════════════════════════════ */

const Store = (() => {

  /* ─────────── IndexedDB ─────────── */
  const DB_NAME = 'gsr', DB_VER = 1;
  let db = null;

  function open() {
    return new Promise((res, rej) => {
      if (db) return res(db);
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains('jobs'))   d.createObjectStore('jobs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv'))     d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        if (!d.objectStoreNames.contains('blobs'))  d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');  // แคชรูปที่ดาวน์โหลดมาแล้ว
      };
      rq.onsuccess = () => { db = rq.result; res(db); };
      rq.onerror   = () => rej(rq.error);
    });
  }

  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const out = fn(t.objectStore(store));
      // ต้องเช็ค 'result' in out ไม่ใช่ out.result !== undefined
      // ไม่งั้นตอนหาไม่เจอ (result = undefined) จะคืน IDBRequest ออกไปแทน ซึ่งเป็น truthy
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror    = () => rej(t.error);
    });
  }

  const put  = (s, v, k) => tx(s, 'readwrite', o => o.put(v, k));
  const del  = (s, k)    => tx(s, 'readwrite', o => o.delete(k));
  const get  = (s, k)    => tx(s, 'readonly',  o => o.get(k));
  const all  = s         => tx(s, 'readonly',  o => o.getAll());

  /* ─────────── แปลงชื่อฟิลด์ app ⇄ ฐานข้อมูล ─────────── */
  const MAP = {
    id: 'id', dateIn: 'date_in', dateOut: 'date_out', status: 'status',
    docNo: 'doc_no', branch: 'branch', productType: 'product_type',
    pattern: 'pattern', part: 'part', defectKind: 'defect_kind', defectSpot: 'defect_spot',
    weightIn: 'weight_in', weightOut: 'weight_out', weightAdd: 'weight_add',
    method: 'method', technician: 'technician', recordedBy: 'recorded_by',
    notes: 'notes', photos: 'photos', legacy: 'legacy', deleted: 'deleted',
    history: 'history', updatedAt: 'updated_at',
  };
  const DB_TO_APP = Object.fromEntries(Object.entries(MAP).map(([a, d]) => [d, a]));

  const toDb = j => {
    const o = {};
    for (const [a, d] of Object.entries(MAP)) {
      if (a === 'updatedAt') continue;               // ให้ฐานข้อมูลใส่เอง
      let v = j[a];
      if (v === '' && ['dateIn', 'dateOut'].includes(a)) v = null;
      if (v !== undefined) o[d] = v;
    }
    return o;
  };
  const fromDb = r => {
    const o = {};
    for (const [d, a] of Object.entries(DB_TO_APP)) o[a] = r[d];
    ['dateIn', 'dateOut', 'notes', 'branch', 'part', 'method', 'technician']
      .forEach(k => { if (o[k] == null) o[k] = ''; });
    ['weightIn', 'weightOut', 'weightAdd']
      .forEach(k => { o[k] = o[k] == null ? null : Number(o[k]); });
    o.photos  = o.photos  || {};
    o.history = o.history || [];
    return o;
  };

  /* ─────────── สถานะในหน่วยความจำ ─────────── */
  let jobs = [];                       // เรียงใหม่→เก่า
  let lists = null, disabled = null;
  let pending = 0;                     // จำนวนรายการค้างในคิว
  const listeners = [];
  const emit = () => listeners.forEach(f => f());

  const sortJobs = () => jobs.sort((a, b) =>
    (b.dateIn || '').localeCompare(a.dateIn || '') || b.id.localeCompare(a.id));

  async function boot() {
    jobs = (await all('jobs')) || [];
    sortJobs();
    lists    = (await get('kv', 'lists'))    || null;
    disabled = (await get('kv', 'disabled')) || {};
    pending  = ((await all('outbox')) || []).length;
    return { jobs, lists, disabled };
  }

  /* ─────────── ดึงจาก cloud ─────────── */

  const PAGE = 1000;   // Supabase คืนสูงสุด 1000 แถวต่อคำขอ ขอมากกว่านี้ก็ได้เท่านี้

  async function pull() {
    const since = (await get('kv', 'lastSync')) || '1970-01-01T00:00:00Z';

    // ต้องวนหน้า และต้องใช้ gte ไม่ใช่ gt
    // แถวที่นำเข้ามาพร้อมกันเป็นชุดมี updated_at เท่ากันเป๊ะ ถ้าใช้ gt
    // จะข้ามแถวที่เหลือในชุดเดียวกันหายไปเงียบ ๆ
    // ดึงซ้ำไม่เสียหาย เพราะเขียนลง IndexedDB ด้วย id เป็นกุญแจอยู่แล้ว
    const rows = [];
    let offset = 0, page;
    do {
      page = await API.select('jobs',
        `select=*&updated_at=gte.${encodeURIComponent(since)}` +
        `&order=updated_at.asc,id.asc&limit=${PAGE}&offset=${offset}`);
      rows.push(...page);
      offset += PAGE;
    } while (page.length === PAGE);

    if (rows.length) {
      const d = await open();
      await new Promise((res, rej) => {
        const t = d.transaction('jobs', 'readwrite');
        const s = t.objectStore('jobs');
        rows.forEach(r => s.put(fromDb(r)));
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
      const newest = rows[rows.length - 1].updated_at;
      await put('kv', newest, 'lastSync');
      jobs = (await all('jobs')) || [];
      sortJobs();
    }

    const lrows = await API.select('lists', 'select=*');
    if (lrows.length) {
      lists = {}; disabled = {};
      lrows.forEach(r => { lists[r.name] = r.values || []; disabled[r.name] = r.disabled || []; });
      await put('kv', lists, 'lists');
      await put('kv', disabled, 'disabled');
    }
    emit();
    return rows.length;
  }

  /* ─────────── บันทึกงาน (ลงเครื่องทันที) ─────────── */

  /**
   * @param job         ข้อมูลงาน (camelCase) — photos ต้องเป็น path แล้ว
   * @param newBlobs    { 'F69-0001/imgDefect.view.jpg': Blob, ... } รูปที่เพิ่งถ่าย
   */
  async function saveJob(job, newBlobs = {}) {
    await put('jobs', job);
    const i = jobs.findIndex(j => j.id === job.id);
    i === -1 ? jobs.unshift(job) : (jobs[i] = job);
    sortJobs();

    for (const [path, blob] of Object.entries(newBlobs)) {
      await put('blobs', blob, path);
      await put('outbox', { kind: 'photo', path });
      await put('photos', blob, path);            // ให้เปิดดูได้ทันทีแม้ยังไม่ได้อัป
    }
    await put('outbox', { kind: 'job', id: job.id });

    pending = ((await all('outbox')) || []).length;
    emit();
    sync();                                       // ลองส่งเลย ไม่รอผล
    return job;
  }

  async function saveLists(nextLists, nextDisabled) {
    lists = nextLists; disabled = nextDisabled;
    await put('kv', lists, 'lists');
    await put('kv', disabled, 'disabled');
    await put('outbox', { kind: 'lists' });
    pending = ((await all('outbox')) || []).length;
    emit();
    sync();
  }

  /* ─────────── ส่งคิวขึ้น cloud ─────────── */

  let syncing = false;
  async function push() {
    const queue = (await all('outbox')) || [];
    for (const item of queue) {
      if (item.kind === 'photo') {
        const blob = await get('blobs', item.path);
        if (blob) await API.uploadPhoto(item.path, blob);
        await del('blobs', item.path);
      } else if (item.kind === 'job') {
        const j = jobs.find(x => x.id === item.id) || await get('jobs', item.id);
        if (j) await API.upsert('jobs', toDb(j));
      } else if (item.kind === 'lists') {
        const rows = Object.keys(lists).map(name => ({
          name, values: lists[name], disabled: disabled[name] || [],
        }));
        if (rows.length) await API.upsert('lists', rows);
      }
      await del('outbox', item.seq);
    }
    pending = ((await all('outbox')) || []).length;
    emit();
  }

  /** @returns {'ok'|'offline'|'auth'|'skip'|'error'} */
  async function sync() {
    if (syncing || !API.isConfigured() || !API.hasSession()) return 'skip';
    syncing = true;
    try {
      await push();
      await pull();
      await put('kv', new Date().toISOString(), 'lastOk');
      return 'ok';
    } catch (e) {
      if (e.offline) return 'offline';
      if (e.auth)    return 'auth';
      console.error('sync', e);
      return 'error';
    } finally {
      syncing = false; emit();
    }
  }

  /* ─────────── รูป ─────────── */

  /** คืน object URL ของรูป — หยิบจากแคชในเครื่องก่อน ไม่มีค่อยโหลดจาก cloud */
  async function photoUrl(path) {
    if (!path) return null;
    let blob = await get('photos', path);
    if (!blob) {
      try {
        blob = await API.downloadPhoto(path);
        await put('photos', blob, path);
      } catch (_) { return null; }               // เน็ตหลุด — ยังไม่มีรูปให้ดู
    }
    return URL.createObjectURL(blob);
  }

  /* ─────────── ล้างทั้งหมด (ใช้ตอนออกจากระบบเครื่องสาธารณะ) ─────────── */
  async function wipe() {
    const d = await open();
    await Promise.all(['jobs', 'kv', 'outbox', 'blobs', 'photos'].map(s =>
      new Promise(res => {
        const t = d.transaction(s, 'readwrite');
        t.objectStore(s).clear(); t.oncomplete = res;
      })));
    jobs = []; lists = null; disabled = {}; pending = 0;
  }

  /* เน็ตกลับมา → ส่งคิวที่ค้างทันที */
  window.addEventListener('online', () => sync());

  return {
    boot, pull, sync, saveJob, saveLists, photoUrl, wipe, toDb, fromDb,
    onChange: f => listeners.push(f),
    get jobs()     { return jobs; },
    get lists()    { return lists; },
    get disabled() { return disabled; },
    get pending()  { return pending; },
  };
})();
