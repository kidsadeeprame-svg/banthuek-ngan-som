/* ═══════════════════════════════════════════════════════════
   Service Worker — เก็บ "ตัวแอป" ไว้ในเครื่อง
   เพื่อให้เปิดแอปได้แม้ไม่มีเน็ต (ข้อมูลอยู่ใน IndexedDB อยู่แล้ว)

   ไม่แคชคำขอไปยัง Supabase เด็ดขาด — ข้อมูลต้องสดเสมอ
   ═══════════════════════════════════════════════════════════ */

const VERSION = 'gsr-v10';
const SHELL = [
  './', './index.html', './app.css?v=10', './config.js?v=10',
  './api.js?v=10', './store.js?v=10', './app.js?v=10',
  './manifest.webmanifest', './icon.svg', './icon-maskable.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ข้ามทุกอย่างที่ไม่ใช่ไฟล์แอปของเรา (Supabase ฯลฯ)
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // network-first: ได้ของใหม่เสมอถ้าเน็ตมา ไม่มีเน็ตค่อยใช้ของในแคช
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
