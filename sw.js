/* Service Worker E-IASMKP. Aturan: permintaan ke Apps Script TIDAK PERNAH di-cache. */
const VER = 'iasmkp-v2.4.2';
const OPSI = ['./js/formulir.js', './js/vendor/jszip.min.js', './tpl/Formulir_Kriteria_SMKP.xlsx']; // untuk unduh formulir offline; kegagalan tidak membatalkan instalasi
const SHELL = ['./', './index.html', './css/style.css', './js/config.js', './js/app.js', './logo.png', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL).then(() => Promise.all(OPSI.map(u => c.add(u).catch(() => 0))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== 'iasmkp-font').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;                                         // POST (API) langsung ke jaringan
  if (/(^|\.)script\.google(usercontent)?\.com$/.test(url.hostname)) return; // GAS: jangan disentuh
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {              // font/ikon: stale-while-revalidate
    e.respondWith(caches.open('iasmkp-font').then(c => c.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {                                            // halaman: jaringan dulu, cadangan cache → buka offline
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VER).then(c => c.put('./index.html', cp)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {                              // aset statis: cache dulu, segarkan di belakang
    const net = fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VER).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
