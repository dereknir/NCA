/* sw.js — 讓網站可以「加到主畫面」, 網路不穩時看過的頁還打得開
   原則: 只快取外殼 (頁面、CSS/JS、字型、圖示), 資料 (*.json) 一律走網路, 不攔。
   - 頁面: 先走網路 (永遠拿最新版), 斷線才拿上次看過的; 都沒有就給首頁
   - /_astro/ (檔名帶 hash, 不會變): 先拿快取
   - /fonts/ /css/ /js/ /icons/: 先給快取、背景再更新 (每首歌的字型檔會在歌詞更新時用同一個檔名重切)
   - 標注工具 (/annotate/)、後台 (/admin/)、跨網域 (YouTube、GitHub API、Google Fonts) 都不碰
   改快取規則時把 VERSION 加一, 舊的快取會在 activate 時清掉 */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const MAX_PAGES = 40;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== PAGES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i++) await cache.delete(keys[i]);
}

async function page(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') { await cache.put(req, res.clone()); trim(cache); }
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || (await caches.match('/')) || Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/annotate/') || p.startsWith('/admin/') || p.endsWith('.json') || p === '/sw.js') return;

  if (req.mode === 'navigate') return e.respondWith(page(req));
  if (p.startsWith('/_astro/')) return e.respondWith(cacheFirst(req));
  if (p.startsWith('/fonts/') || p.startsWith('/css/') || p.startsWith('/js/') || p.startsWith('/icons/')) return e.respondWith(staleWhileRevalidate(req, e));
});
