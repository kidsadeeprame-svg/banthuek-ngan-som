/* ═══════════════════════════════════════════════════════════
   คุยกับ Supabase ผ่าน REST ตรง ๆ
   ไม่ใช้ไลบรารี npm เลย → ไม่ต้อง build → git push แล้วใช้ได้ทันที
   ═══════════════════════════════════════════════════════════ */

const API = (() => {
  const C = window.CONFIG;
  const REST    = () => `${C.SUPABASE_URL}/rest/v1`;
  const AUTH    = () => `${C.SUPABASE_URL}/auth/v1`;
  const STORAGE = () => `${C.SUPABASE_URL}/storage/v1`;
  const SESSION_KEY = 'gsr.session';

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}

  const isConfigured = () =>
    !!C.SUPABASE_URL && !C.SUPABASE_URL.includes('xxxxx') &&
    !!C.SUPABASE_ANON_KEY && !C.SUPABASE_ANON_KEY.includes('วาง');

  function headers(extra = {}) {
    const h = { apikey: C.SUPABASE_ANON_KEY, ...extra };
    h.Authorization = `Bearer ${session?.access_token || C.SUPABASE_ANON_KEY}`;
    return h;
  }

  /** โยน Error ที่อ่านรู้เรื่องเสมอ เพื่อให้ชั้นบนแยกออกว่า "เน็ตล่ม" หรือ "ของเราผิด" */
  async function req(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      const err = new Error('offline'); err.offline = true; throw err;
    }
    if (res.status === 401 || res.status === 403) {
      const err = new Error('unauthorized'); err.auth = true; throw err;
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (_) { detail = res.statusText; }
      throw new Error(`${res.status} ${detail}`);
    }
    return res;
  }

  /* ─────────── ล็อกอิน ─────────── */

  async function signIn(email, password) {
    const res = await req(`${AUTH()}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: C.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(e => {
      if (e.auth) { const x = new Error('bad-pin'); x.badPin = true; throw x; }
      throw e;
    });
    session = await res.json();
    session.expires_at = Date.now() + (session.expires_in - 60) * 1000;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async function refresh() {
    if (!session?.refresh_token) return null;
    try {
      const res = await req(`${AUTH()}/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: C.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      session = await res.json();
      session.expires_at = Date.now() + (session.expires_in - 60) * 1000;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch (e) {
      if (e.offline) return session;   // เน็ตล่ม — ใช้ token เดิมไปก่อน
      signOut(); return null;
    }
  }

  /** เรียกก่อนทุกครั้งที่จะยิง REST — ต่ออายุ token ถ้าใกล้หมด */
  async function ensure() {
    if (!session) return false;
    if (session.expires_at && Date.now() > session.expires_at) await refresh();
    return !!session;
  }

  function signOut() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
  }

  const hasSession = () => !!session;

  /* ─────────── ตาราง ─────────── */

  async function select(table, query = '') {
    await ensure();
    const res = await req(`${REST()}/${table}?${query}`, { headers: headers() });
    return res.json();
  }

  /** upsert = แทรกใหม่ หรือทับของเดิมถ้า primary key ซ้ำ */
  async function upsert(table, rows) {
    await ensure();
    const res = await req(`${REST()}/${table}`, {
      method: 'POST',
      headers: headers({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    });
    return res.json();
  }

  /* ─────────── รูปภาพ ─────────── */

  /** path เช่น  F69-0001/imgDefect.view.jpg */
  async function uploadPhoto(path, blob) {
    await ensure();
    await req(`${STORAGE()}/object/photos/${encodeURI(path)}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' }),
      body: blob,
    });
    return path;
  }

  /** bucket เป็น private — ดาวน์โหลดมาเป็น Blob แล้วแคชไว้ในเครื่อง (ดู store.js) */
  async function downloadPhoto(path) {
    await ensure();
    const res = await req(`${STORAGE()}/object/photos/${encodeURI(path)}`, { headers: headers() });
    return res.blob();
  }

  return {
    isConfigured, signIn, signOut, hasSession, ensure, refresh,
    select, upsert, uploadPhoto, downloadPhoto,
    get user() { return session?.user || null; },
  };
})();
