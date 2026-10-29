/* site-shell.js — 全站外殼的行為 (樣式在 /css/site-shell.css)
   - 頁首: Astro 頁由 BaseLayout 直接輸出; 靜態頁放一個空的 <header data-sh-header>, 這裡依 /site-index.json 補上
   - hero: 星空 + 右側像素行星 (data-planet), 歌曲頁改畫封面馬賽克 (data-cover)
   - 指令列: 按 / 叫出, 搜歌名 / 頁面 / 日記 / 作品 / 指令
   - 單鍵換頁: 選單上的 [T] [K] …, 輸入框裡、按著修飾鍵、或有 overlay 開著時不觸發
   冪等: DOMContentLoaded 跟 astro:page-load (翻譯頁圈內的 ClientRouter 換頁) 都會呼叫 init */
(() => {
  if (window.__shell) return;
  window.__shell = true;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const norm = p => (p.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/');

  let indexP = null;
  const loadIndex = () => indexP ||= fetch('/site-index.json').then(r => r.json()).catch(() => null);

  const allItems = idx => idx.groups.flatMap(g => g.items.map(it => ({ ...it, group: g.name })));
  // 目前頁面屬於哪個選單項: 路徑前綴最長者 (/live/timeline 算 Live)
  const currentItem = idx => {
    const here = norm(location.pathname);
    return allItems(idx).filter(it => here === norm(it.href) || here.startsWith(norm(it.href) + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0] || null;
  };

  function headerHTML(idx, cur) {
    const groups = idx.groups.map(g => `<div class="sh-grp${cur && cur.group === g.name ? ' on' : ''}">
      <button type="button" aria-haspopup="true">${esc(g.name)}</button><div class="sh-menu">${g.items.map(it =>
        `<a href="${it.href}"${cur && cur.href === it.href ? ' class="cur" aria-current="page"' : ''}><kbd>[${it.key}]</kbd>${esc(it.name)}<span>${esc((idx.planets[it.planet] || {}).ja || '')}</span></a>`).join('')}</div></div>`).join('');
    return `<div class="sh-wrap"><a class="sh-logo" href="/">Derek's Site</a><span class="sh-dock"></span>
      <button class="sh-burger" type="button" aria-expanded="false">選單</button><nav class="sh-nav">${groups}</nav></div><div class="sh-prog"></div>`;
  }

  function wireHeader(hd) {
    if (hd.dataset.wired) return;
    hd.dataset.wired = '1';
    const nav = hd.querySelector('.sh-nav'), burger = hd.querySelector('.sh-burger');
    burger?.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open);
    });
    // 觸控裝置沒有 hover: 點組名開關; 點外面關掉
    hd.querySelectorAll('.sh-grp > button').forEach(b => b.addEventListener('click', () => {
      const g = b.parentElement, was = g.classList.contains('open');
      hd.querySelectorAll('.sh-grp.open').forEach(x => x.classList.remove('open'));
      if (!was) g.classList.add('open');
    }));
    document.addEventListener('click', e => {
      if (!hd.contains(e.target)) hd.querySelectorAll('.sh-grp.open').forEach(x => x.classList.remove('open'));
    });
  }

  /* ---------- 畫圖 ---------- */
  // rAF 迴圈: 元素離開 DOM (換頁) 就停, 滾出畫面就暫停
  function loop(el, frame) {
    let vis = true;
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { vis = es[0].isIntersecting; }).observe(el);
    frame(0);
    if (still) return;
    (function f(t) {
      if (!el.isConnected) return;
      if (vis && !document.hidden) frame(t);
      requestAnimationFrame(f);
    })(0);
  }

  function starfield(bg, seed) {
    const c = document.createElement('canvas');
    bg.append(c);
    const W = c.width = 320, H = c.height = 120, g = c.getContext('2d');
    let s = (seed * 9301 | 0) % 2147483646 + 1;
    const r = () => (s = s * 16807 % 2147483647) / 2147483647;
    const st = Array.from({ length: 90 }, () => ({ x: r() * W | 0, y: r() * H | 0, p: r() * 6.28, b: r() < .15 }));
    loop(c, t => {
      g.clearRect(0, 0, W, H);
      for (const p of st) {
        const a = still ? .7 : .35 + .65 * Math.abs(Math.sin(t / 900 + p.p));
        g.fillStyle = p.b ? `rgba(232,201,74,${a})` : `rgba(205,214,238,${a})`;
        g.fillRect(p.x, p.y, 1, 1);
      }
    });
  }

  function mosaic(bg, src) {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    bg.append(c);
    const im = new Image();
    im.onload = () => c.getContext('2d').drawImage(im, 0, 0, 24, 24);
    im.src = src;
  }

  // 48×48 像素行星: 四階 Bayer 抖色 + 依類型的紋理 (氣態帶 / 岩石坑 / 海陸 / 土星環 / 小行星帶)
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = (h ^ (h >>> 13)) * 1274126177 >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  function orb(hero, planet) {
    const c = document.createElement('canvas');
    c.className = 'sh-orb';
    c.setAttribute('aria-hidden', 'true');
    hero.append(c);
    const N = c.width = c.height = 48, g = c.getContext('2d'), pal = planet.palette, kind = planet.kind;
    const ring = kind === 'ring', R = ring ? 15 : 20, img = g.createImageData(N, N);
    const put = (x, y, col) => { const i = (y * N + x) * 4; img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255; };
    const rocks = [[14, 30, 7], [31, 17, 9], [36, 34, 5], [22, 12, 4]];
    loop(c, t => {
      img.data.fill(0);
      const rot = t / 7000;
      if (kind === 'belt') {
        for (const [cx, cy, rr] of rocks) for (let y = cy - rr; y <= cy + rr; y++) for (let x = cx - rr; x <= cx + rr; x++) {
          const dx = (x - cx) / rr, dy = (y - cy) / rr, wob = .75 + .3 * vnoise(Math.atan2(dy, dx) * 2 + cx, cy);
          if (dx * dx + dy * dy > wob * wob || x < 0 || y < 0 || x >= N || y >= N) continue;
          const lit = .6 - .5 * dx - .4 * dy + vnoise(x * .5 + rot * 6, y * .5) * .4 + BAYER[(y % 4) * 4 + x % 4] / 40;
          put(x, y, pal[Math.max(0, Math.min(4, 4 - Math.floor(lit * 3.2)))]);
        }
        g.putImageData(img, 0, 0);
        return;
      }
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x - 24 + .5) / R, dy = (y - 24 + .5) / R, d = dx * dx + dy * dy;
        if (d > 1) continue;
        const z = Math.sqrt(1 - d), lon = Math.atan2(dx, z) + rot, lat = Math.asin(dy);
        let lit = Math.max(0, -.5 * dx - .45 * dy + .75 * z);
        let tex = 0, land = false;
        if (kind === 'gas' || ring) tex = Math.sin(lat * 9 + vnoise(lon * 2, lat * 3) * 2) * .5 + vnoise(lon * 4, lat * 12) * .3 - .15;
        else if (kind === 'wet') { const n = vnoise(lon * 2.6 + 9, lat * 3) * .7 + vnoise(lon * 6, lat * 6) * .3; land = n > .55; tex = land ? .1 : -.05; }
        else if (kind === 'star') tex = vnoise(lon * 5, lat * 5 + rot * 4) * .4;
        else tex = vnoise(lon * 5, lat * 5) * .5 - .25 - (vnoise(lon * 11 + 3, lat * 11) > .78 ? .35 : 0);
        if (kind === 'star') lit = .55 + z * .5;
        const v = lit * 1.05 + tex * .35 + BAYER[(y % 4) * 4 + x % 4] / 16 * .28 - .14;
        let i = v > .85 ? 0 : v > .6 ? 1 : v > .38 ? 2 : v > .18 ? 3 : 4;
        if (kind === 'wet') i = land ? (v > .5 ? 2 : 3) : (v > .62 ? 0 : v > .3 ? 1 : 4);
        put(x, y, pal[i]);
      }
      if (ring) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x - 24 + .5), dy = (y - 24 + .5) * 3.2 + dx * .35, e = Math.sqrt(dx * dx + dy * dy);
        if (e < 18 || e > 23.5 || (e > 20.2 && e < 20.9)) continue;
        const front = dy > 0 || Math.hypot((x - 24 + .5) / R, (y - 24 + .5) / R) > 1;
        if (front) put(x, y, pal[(BAYER[(y % 4) * 4 + x % 4] > 8 ? 1 : 2) + (e > 21.5 ? 1 : 0)]);
      }
      g.putImageData(img, 0, 0);
    });
  }

  /* ---------- 指令列 ---------- */
  function buildCli(idx) {
    if (document.querySelector('.sh-cli')) return;
    const box = document.createElement('div');
    box.className = 'sh-cli';
    box.innerHTML = `<div class="sh-cli-pill" role="button" tabindex="0" aria-label="打開指令列"><span>guest@nishina</span><span class="gt">&gt;</span><span class="hint">按 / 搜尋歌名、跳頁</span></div>
      <div class="sh-cli-panel"><div class="sh-wrap"><div class="sh-cli-out" role="listbox"></div>
      <label class="sh-cli-line"><span class="u">guest@nishina</span><span class="gt">&gt;</span><input type="text" autocomplete="off" spellcheck="false" placeholder="/help" aria-label="指令列"><button class="esc" type="button">esc</button></label></div></div>`;
    document.body.append(box);
    const pill = box.querySelector('.sh-cli-pill'), out = box.querySelector('.sh-cli-out'), input = box.querySelector('input');
    let hits = [], sel = 0;

    const items = allItems(idx);
    const cmds = [
      ...items.map(it => ({ k: '/' + norm(it.href).slice(1).split('/')[0], t: it.name, href: it.href })),
      { k: '/random', t: '隨機一首歌', run: () => { const s = idx.songs[Math.random() * idx.songs.length | 0]; location.href = '/translations/' + s.id; } },
      { k: '/home', t: '首頁', href: '/' },
      { k: '/top', t: '回到頁首', run: () => { close(); scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); } },
      { k: '/help', t: '列出所有指令', run: () => { input.value = '/'; render(); } },
    ];
    const search = q => {
      if (q.startsWith('/')) {
        const hit = cmds.filter(c => c.k.startsWith(q.toLowerCase()));
        if (hit.length || q === '/') return hit;
        q = q.slice(1);   // 「/わをん」沒有對應指令 → 當歌名搜
      }
      const w = q.toLowerCase();
      const songs = idx.songs.filter(s => s.title.toLowerCase().includes(w) || s.id.includes(w))
        .slice(0, 8).map(s => ({ k: s.title, t: s.album, href: '/translations/' + s.id, ja: true }));
      const pages = items.filter(it => it.name.toLowerCase().includes(w)).map(it => ({ k: it.name, t: '頁面', href: it.href }));
      const posts = [...idx.diary.map(d => ({ ...d, t: '日記' })), ...idx.projects.map(p => ({ ...p, t: '作品' }))]
        .filter(p => p.title.toLowerCase().includes(w)).slice(0, 4).map(p => ({ k: p.title, t: p.t, href: p.href }));
      return [...pages, ...songs, ...posts];
    };
    function render() {
      const q = input.value.trim();
      if (!q) { out.innerHTML = ''; hits = []; return; }
      hits = search(q);
      sel = Math.min(sel, Math.max(0, hits.length - 1));
      out.innerHTML = hits.length
        ? hits.map((h, i) => `<a href="${h.href || '#'}" data-i="${i}" role="option"${i === sel ? ' class="sel" aria-selected="true"' : ''}><span${h.ja ? ' lang="ja"' : ''}>${esc(h.k)}</span><span>${esc(h.t)}</span></a>`).join('')
        : `<div class="none">command not found: ${esc(q)}　試試 /help</div>`;
      out.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    const go = h => { if (!h) return; if (h.run) h.run(); else location.href = h.href; };
    function open(seed = '') {
      box.classList.add('open');
      input.value = seed;
      sel = 0;
      render();
      input.focus();
    }
    function close() { box.classList.remove('open'); input.value = ''; render(); input.blur(); }
    pill.addEventListener('click', () => open());
    pill.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    box.querySelector('.esc').addEventListener('click', close);
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (hits.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; render(); }
      } else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    out.addEventListener('click', e => {
      const a = e.target.closest('a[data-i]');
      const h = a && hits[+a.dataset.i];
      if (h && h.run) { e.preventDefault(); h.run(); }
    });
    document.addEventListener('pointerdown', e => { if (box.classList.contains('open') && !box.contains(e.target)) close(); });
    window.__shellCli = { open };
  }

  // 單鍵: / 開指令列, 字母換頁。輸入中 / 修飾鍵 / overlay (LiveStage、目錄抽屜) 開著時不動
  function wireKeys(idx) {
    const byKey = Object.fromEntries(allItems(idx).map(it => [it.key.toLowerCase(), it.href]));
    addEventListener('keydown', e => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      if ((window.__scrollLockCount || 0) > 0) return;
      if (e.key === '/') { e.preventDefault(); window.__shellCli?.open(); return; }
      const href = !e.shiftKey && byKey[e.key.toLowerCase()];
      if (href && norm(href) !== norm(location.pathname)) location.href = href;
    });
  }

  /* ---------- init ---------- */
  async function init() {
    const hero = document.querySelector('[data-sh-hero]');
    let hd = document.querySelector('[data-sh-header]');
    const idx = await loadIndex();
    if (idx && hd && !hd.children.length) hd.innerHTML = headerHTML(idx, currentItem(idx));
    hd = hd || document.querySelector('.sh-hd');
    if (hd) wireHeader(hd);

    const cur = idx && currentItem(idx);
    const pkey = hero?.dataset.planet || cur?.planet;
    const planet = hero?.dataset.palette ? { palette: JSON.parse(hero.dataset.palette), kind: hero.dataset.kind }
      : idx && pkey ? idx.planets[pkey] : null;
    if (planet) document.documentElement.style.setProperty('--sh-accent', planet.palette[0].join(' '));

    const title = hero?.querySelector('.sh-title')?.textContent.trim();
    const dock = hd?.querySelector('.sh-dock');
    if (dock && title && !dock.textContent) dock.innerHTML = `／ <b>${esc(title)}</b>`;

    if (hero && !hero.dataset.drawn) {
      hero.dataset.drawn = '1';
      const bg = hero.querySelector('.sh-hero-bg');
      if (hero.dataset.cover) mosaic(bg, hero.dataset.cover);
      else {
        starfield(bg, pkey ? pkey.length * 7.3 : 3);
        if (planet) orb(hero, planet);
      }
    }
    if (idx) buildCli(idx);   // ClientRouter 換頁會換掉 body, 指令列要重建 (buildCli 自己防重複)
    if (idx && !window.__shellKeys) {
      window.__shellKeys = true;
      wireKeys(idx);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('astro:page-load', init);
})();
