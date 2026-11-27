/* sw.js — 讓網站可以「加到主畫面」, 網路不穩時看過的頁還打得開
   原則: 只快取外殼 (頁面、CSS/JS、字型、圖示), 資料 (*.json)、圖片、影音都不攔, 一律走網路。
   - 頁面 (換頁, 以及翻譯頁圈內 ClientRouter 自己 fetch 的 HTML): 先走網路 (永遠最新版),
     斷線或 4 秒沒回才拿上次看過的; 沒看過就給離線頁 (503), 不假裝是別頁
   - /css/ /js/ /fonts/ /icons/ (檔名不帶 hash, 部署會換內容): 一樣先走網路, 斷線才拿快取
   - /_astro/ (檔名帶 hash, 內容不會變): 先拿快取
   - 標注工具 (/annotate/)、後台 (/admin/)、跨網域、Range 請求、預抓都不存
   改快取規則時把 VERSION 加一, 舊的快取會在 activate 時清掉 */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const OFFLINE = '/offline.html';
const LIMIT = { [SHELL]: 150, [PAGES]: 40 };
const TIMEOUT = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([OFFLINE])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !(k in LIMIT)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function store(name, key, res) {
  const cache = await caches.open(name);
  await cache.put(key, res);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - LIMIT[name]; i++) if (new URL(keys[i].url).pathname !== OFFLINE) await cache.delete(keys[i]);
}

// 同一頁的 /about 與 /about/ 存成同一筆
const pageKey = (url) => url.origin + (url.pathname.endsWith('/') || /\.[a-z0-9]+$/i.test(url.pathname) ? url.pathname : url.pathname + '/');

function fetchWithTimeout(req) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), TIMEOUT);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

async function networkFirst(e, name, key) {
  const prefetch = /prefetch|prerender/.test(e.request.headers.get('Sec-Purpose') || '');
  try {
    const res = await fetchWithTimeout(e.request);
    // 只存正常的 200 (404、轉址、預抓都不存); 存在背景做, 不擋頁面顯示
    const ok = res.status === 200 && res.type === 'basic' && !prefetch
      && (name !== PAGES || (res.headers.get('content-type') || '').startsWith('text/html'));
    if (ok) e.waitUntil(store(name, key, res.clone()));
    return res;
  } catch (err) {
    const hit = await caches.match(key, { ignoreSearch: true });
    if (hit) return hit;
    if (name !== PAGES) return Response.error();
    const off = await caches.match(OFFLINE);
    return off ? new Response(off.body, { status: 503, statusText: 'Offline', headers: off.headers }) : Response.error();
  }
}

async function cacheFirst(e) {
  const hit = await caches.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.status === 200 && res.type === 'basic') e.waitUntil(store(SHELL, e.request, res.clone()));
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/annotate/') || p.startsWith('/admin/') || p === '/sw.js') return;

  // ClientRouter 的 fetch 帶 Accept: */*, 只能看網址: 沒有副檔名的就當頁面 (存之前再確認是 text/html)
  const html = req.mode === 'navigate' || (req.destination === '' && !/\.[a-z0-9]+$/i.test(p));
  if (html) return e.respondWith(networkFirst(e, PAGES, pageKey(url)));
  if (p.startsWith('/_astro/')) return e.respondWith(cacheFirst(e));
  if (/^\/(css|js|fonts|icons)\//.test(p)) return e.respondWith(networkFirst(e, SHELL, url.origin + p));
});
