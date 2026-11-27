/* site-shell.js — 全站外殼的行為 (樣式在 /css/site-shell.css)
   - 頁首: Astro 頁由 BaseLayout 直接輸出; 靜態頁放一個空的 <header data-sh-header>, 這裡依 /site-index.json 補上
   - hero: 星空 + 右側像素行星 (data-planet), 歌曲頁改畫封面馬賽克 (data-cover)
   - 指令列: 按 / 叫出, 搜歌名 / 頁面 / 日記 / 作品 / 指令
   - 單鍵換頁: 選單上的 [T] [K] …, 輸入框裡、按著修飾鍵、或有 overlay 開著時不觸發
   - 按 ? (或頁尾狀態列的 ?): 鍵盤快捷鍵說明, 從選單設定自己長出來, 不用另外維護
   冪等: DOMContentLoaded 跟 astro:page-load (翻譯頁圈內的 ClientRouter 換頁) 都會呼叫 init */
(() => {
  if (window.__shell) return;
  window.__shell = true;

  // 不擋畫面的外部 CSS (Google Fonts): 先用 media="print" 下載, 這裡換回 all 套用
  document.querySelectorAll('link[data-async-css]').forEach(l => { l.media = 'all'; });

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const norm = p => (p.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/');

  let indexP = null;
  const loadIndex = () => indexP ||= fetch('/site-index.json').then(r => r.json()).catch(() => null);

  // 歌詞全文 (/lyrics-index.json): 指令列真的開始搜的時候才抓, 抓到之前照樣先列歌名、頁面
  let lyrP = null, LYR = null;
  const loadLyrics = () => lyrP ||= fetch('/lyrics-index.json').then(r => r.json()).then(d => {
    const fold = x => x.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    LYR = { songs: d.songs, lines: d.lines.map(([si, li, ja, zh, ro]) => ({ si, li, ja, zh, ro, f: [fold(ja), fold(zh), fold(ro)] })), fold };
    return LYR;
  }).catch(() => null);
  // 一句歌詞裡符合的那段前後各留一點, 太長就截; 符合的字用 <mark>
  const snippet = (text, q) => {
    const i = text.normalize('NFKC').toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    const a = Math.max(0, i - 14), b = Math.min(text.length, i + q.length + 14);
    return (a ? '…' : '') + esc(text.slice(a, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, b)) + (b < text.length ? '…' : '');
  };
  function lyricHits(raw) {
    if (!LYR) return [];
    const q = LYR.fold(raw);
    const latin = /^[a-z0-9 '-]+$/.test(q);
    if (!q || (latin && q.length < 3)) return [];   // 羅馬拼音少於 3 個字母太多雜訊
    const out = [], perSong = new Map();
    for (const L of LYR.lines) {
      const hit = L.f[0].includes(q) ? 0 : L.f[1].includes(q) ? 1 : latin && L.f[2].includes(q) ? 2 : -1;
      if (hit < 0) continue;
      const text = [L.ja, L.zh, L.ro][hit];
      const done = perSong.get(L.si) || new Set();
      if (done.size >= 2 || done.has(text)) continue;   // 一首歌最多兩句、副歌重複的同一句只列一次
      done.add(text); perSong.set(L.si, done);
      const [id, title] = LYR.songs[L.si];
      out.push({ html: snippet(text, q), ja: hit !== 1, t: title, href: `/translations/${id}/#L${L.li + 1}`, lyric: true });
      if (out.length >= 8) break;
    }
    return out;
  }

  const allItems = idx => idx.groups.flatMap(g => g.items.map(it => ({ ...it, group: g.name })));
  // 目前頁面屬於哪個選單項: 路徑前綴最長者 (/live/timeline 算 Live)
  const currentItem = idx => {
    const here = norm(location.pathname);
    return allItems(idx).filter(it => here === norm(it.href) || here.startsWith(norm(it.href) + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0] || null;
  };

  function headerHTML(idx, cur) {
    const groups = idx.groups.map((g, gi) => `<div class="sh-grp${cur && cur.group === g.name ? ' on' : ''}">
      <button type="button" aria-expanded="false" aria-controls="sh-menu-${gi}">${esc(g.name)}</button><div class="sh-menu" id="sh-menu-${gi}">${g.items.map(it =>
        `<a href="${it.href}"${cur && cur.href === it.href ? ' class="cur" aria-current="page"' : ''}><kbd>[${it.key}]</kbd>${esc(it.name)}<span>${esc((idx.planets[it.planet] || {}).ja || '')}</span></a>`).join('')}</div></div>`).join('');
    return `<div class="sh-wrap"><a class="sh-logo" href="/">Derek's Site</a><span class="sh-dock"></span>
      <button class="sh-burger" type="button" aria-expanded="false" aria-controls="sh-nav">選單</button><nav class="sh-nav" id="sh-nav" aria-label="全站">${groups}</nav></div><div class="sh-prog"></div>`;
  }

  // 掛在 document / window 上的監聽: ClientRouter 換頁會換掉頁首、指令列, 舊的那批跟著拆掉, 不會越疊越多
  const scope = {};
  const fresh = k => { scope[k]?.abort(); return (scope[k] = new AbortController()).signal; };

  // 頁首: 每組是一顆展開按鈕 (aria-expanded) + 一串連結。滑鼠滑過去照樣會開 (CSS :hover);
  // 鍵盤是按 Enter / 空白鍵開, Esc 關回按鈕上, Tab 離開那組就收起來
  function wireHeader(hd) {
    if (hd.dataset.wired) return;
    hd.dataset.wired = '1';
    const signal = fresh('header');
    const nav = hd.querySelector('.sh-nav'), burger = hd.querySelector('.sh-burger');
    const setGrp = (g, open) => { g.classList.toggle('open', open); g.querySelector(':scope > button').setAttribute('aria-expanded', open); };
    const closeGrps = except => hd.querySelectorAll('.sh-grp.open').forEach(g => { if (g !== except) setGrp(g, false); });
    const setNav = open => { nav.classList.toggle('open', open); burger.setAttribute('aria-expanded', open); };
    burger?.addEventListener('click', () => setNav(!nav.classList.contains('open')));
    hd.querySelectorAll('.sh-grp > button').forEach(b => b.addEventListener('click', () => {
      if (nav.classList.contains('open')) return;   // 手機選單攤開的時候每組都是展開的, 組名只是標題
      const g = b.parentElement;
      closeGrps(g);
      setGrp(g, !g.classList.contains('open'));
    }));
    hd.addEventListener('focusout', e => {
      const g = e.target.closest('.sh-grp');
      if (g && !g.contains(e.relatedTarget)) setGrp(g, false);
    });
    hd.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const g = e.target.closest('.sh-grp.open');
      if (g) { e.stopPropagation(); setGrp(g, false); g.querySelector(':scope > button').focus(); }
      else if (nav.classList.contains('open')) { e.stopPropagation(); setNav(false); burger.focus(); }
    });
    // 點頁首外面: 開著的組、手機選單都收起來
    document.addEventListener('click', e => {
      if (hd.contains(e.target)) return;
      closeGrps();
      if (nav.classList.contains('open')) setNav(false);
    }, { signal });
  }

  /* ---------- 畫圖 ---------- */
  // rAF 迴圈: 滾出畫面、切到別的分頁就整個停掉 (不是空轉), 回來再接著跑; 元素離開 DOM (換頁) 就收工。
  // fps: 像素畫一秒十幾格就夠了, 不用每一幀都重畫
  function loop(el, frame, fps = 60) {
    frame(0);
    if (still) return;
    const gap = 1000 / fps, ac = new AbortController();
    let raf = 0, last = -1e9, vis = true;
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const f = t => {
      raf = 0;
      if (!el.isConnected) { ac.abort(); io.disconnect(); return; }
      if (t - last >= gap) { last = t; frame(t); }
      raf = requestAnimationFrame(f);
    };
    const run = () => { if (!raf && vis && !document.hidden && el.isConnected) raf = requestAnimationFrame(f); };
    const io = new IntersectionObserver(es => { vis = es[0].isIntersecting; vis ? run() : stop(); });
    io.observe(el);
    document.addEventListener('visibilitychange', () => document.hidden ? stop() : run(), { signal: ac.signal });
    run();
  }

  function starfield(bg, seed) {
    const c = document.createElement('canvas');
    bg.append(c);
    // 寬固定 320 格, 高照 hero 比例算 — 手機 hero 又窄又高, 固定 120 會把星星拉成直線
    const W = c.width = 320, H = c.height = Math.max(60, Math.round(W * (bg.clientHeight || 120) / (bg.clientWidth || W)));
    const g = c.getContext('2d');
    let s = (seed * 9301 | 0) % 2147483646 + 1;
    const r = () => (s = s * 16807 % 2147483647) / 2147483647;
    const st = Array.from({ length: Math.round(90 * H / 120) }, () => ({ x: r() * W | 0, y: r() * H | 0, p: r() * 6.28, b: r() < .15 }));
    loop(c, t => {
      g.clearRect(0, 0, W, H);
      for (const p of st) {
        const a = still ? .7 : .35 + .65 * Math.abs(Math.sin(t / 900 + p.p));
        g.fillStyle = p.b ? `rgba(232,201,74,${a})` : `rgba(205,214,238,${a})`;
        g.fillRect(p.x, p.y, 1, 1);
      }
    }, 20);
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
    }, 15);
  }

  /* ---------- N247i (觸控裝置的指令列按鈕) ---------- */
  // 12×16 的小折疊機, 像素畫成 SVG
  const PHONE_ICON = '<svg class="sh-cli-phone" viewBox="0 0 12 16" width="12" height="16" shape-rendering="crispEdges" aria-hidden="true">'
    + '<rect x="1" y="0" width="10" height="16" fill="#3b335f"/><rect x="2" y="1" width="8" height="14" fill="#c9c3e6"/>'
    + '<rect x="3" y="2" width="6" height="5" fill="#0b1022"/><rect x="4" y="3" width="2" height="1" fill="#e8c94a"/>'
    + '<rect x="2" y="8" width="8" height="1" fill="#3b335f"/>'
    + '<rect x="3" y="10" width="2" height="1" fill="#3b335f"/><rect x="7" y="10" width="2" height="1" fill="#3b335f"/>'
    + '<rect x="3" y="12" width="2" height="1" fill="#3b335f"/><rect x="7" y="12" width="2" height="1" fill="#3b335f"/></svg>';
  let phoneP = null;
  function loadPhone() {
    if (window.N247i) return Promise.resolve();
    if (!document.querySelector('link[href="/css/n247i.css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/n247i.css'; document.head.append(l);
    }
    return phoneP || (phoneP = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = '/js/n247i.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc);
    }));
  }

  /* ---------- 指令列 ---------- */
  function buildCli(idx) {
    if (document.querySelector('.sh-cli')) return;
    const box = document.createElement('div');
    box.className = 'sh-cli';
    box.setAttribute('role', 'search');   // 指令列就是全站搜尋: 給它一個 search 區塊
    box.setAttribute('aria-label', '指令列');
    // 觸控裝置沒有實體鍵盤, 指令列按鈕換成像素ガラケー N247i (打開直接是 MENU, 左鍵「検索」再回到指令列)
    const coarse = matchMedia('(pointer: coarse)').matches;
    // aria-label 要把畫面上看得到的字原樣包進去 (用語音控制的人是照著畫面念的, WCAG 2.5.3), 用途補在後面。
    // span 之間的空白在 flex 裡不佔位置, 只是讓念出來的字跟 label 對得上
    const pillHTML = coarse
      ? `<button type="button" class="sh-cli-pill sh-cli-pill--phone" aria-label="N247i MENU (打開選單)">${PHONE_ICON}<span>N247i</span> <span class="hint">MENU</span></button>`
      : `<button type="button" class="sh-cli-pill" aria-label="guest@nishina > 按 / 搜歌名、歌詞、跳頁 (打開指令列)"><span>guest@nishina</span> <span class="gt">&gt;</span> <span class="hint">按 / 搜歌名、歌詞、跳頁</span></button>`;
    // 輸入框是 combobox: 下面的結果是它的 listbox, 方向鍵選到哪一個由 aria-activedescendant 告訴讀螢幕
    box.innerHTML = `${pillHTML}
      <div class="sh-cli-panel"><div class="sh-wrap"><div class="sh-cli-out" id="sh-cli-out" role="listbox" aria-label="搜尋結果"></div>
      <label class="sh-cli-line"><span class="u">guest@nishina</span><span class="gt">&gt;</span><input type="text" role="combobox" aria-expanded="false" aria-controls="sh-cli-out" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="/help" aria-label="指令列"><span class="sh-cli-keys" aria-hidden="true"><kbd>↑↓</kbd> 選 <kbd>↵</kbd> 開</span><button class="esc" type="button">esc</button></label></div></div>`;
    document.body.append(box);
    const pill = box.querySelector('.sh-cli-pill'), out = box.querySelector('.sh-cli-out'), input = box.querySelector('input');
    let hits = [], sel = 0, back = null;
    const signal = fresh('cli');

    const items = allItems(idx);
    // 頁面指令就是整段路徑 (/live、/live/full 各一個); 同一個路徑只留第一個
    const seen = new Set();
    const cmds = [
      ...items.map(it => ({ k: norm(it.href), t: it.name, href: it.href })).filter(c => !seen.has(c.k) && seen.add(c.k)),
      { k: '/random', t: '隨機一首歌', run: () => { const s = idx.songs[Math.random() * idx.songs.length | 0]; location.href = '/translations/' + s.id; } },
      { k: '/home', t: '首頁', href: '/' },
      { k: '/top', t: '回到頁首', run: () => { close(); scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); } },
      { k: '/help', t: '列出所有指令', run: () => { input.value = '/'; render(); } },
      { k: '/keys', t: '鍵盤快捷鍵 (也可以直接按 ?)', run: () => { close(); window.__shellHelp?.open(); } },
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
      const find = (list, t) => list.filter(p => p.title.toLowerCase().includes(w)).slice(0, 4).map(p => ({ k: p.title, t, href: p.href }));
      const diary = find(idx.diary, '日記'), projects = find(idx.projects, '作品');
      // 歌詞全文: 歌名之後列「唱到它的句子」(第一次搜的時候去抓索引, 抓到再重畫一次)
      if (!LYR) loadLyrics().then(d => { if (d && box.classList.contains('open')) render(); });
      const lyr = lyricHits(q);
      // 先列這一區的: 在日記頁搜, 日記排最前面; 作品集、翻譯頁同理。其他頁照原本: 頁面 → 歌 → 歌詞 → 日記 / 作品
      const here = norm(location.pathname);
      if (here.startsWith('/diary')) return [...diary, ...pages, ...songs, ...lyr, ...projects];
      if (here.startsWith('/projects')) return [...projects, ...pages, ...songs, ...lyr, ...diary];
      if (here.startsWith('/translations')) return [...songs, ...lyr, ...pages, ...diary, ...projects];
      return [...pages, ...songs, ...lyr, ...diary, ...projects];
    };
    function render() {
      const q = input.value.trim();
      if (!q) { out.replaceChildren(); hits = []; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); return; }
      hits = search(q);
      sel = Math.min(sel, Math.max(0, hits.length - 1));
      out.innerHTML = hits.length
        ? hits.map((h, i) => `<a href="${h.href || '#'}" id="sh-cli-o${i}" data-i="${i}" role="option" aria-selected="${i === sel}" class="${[i === sel ? 'sel' : '', h.lyric ? 'lyr' : ''].join(' ').trim()}"><span${h.ja ? ' lang="ja"' : ''}>${h.html ?? esc(h.k)}</span><span>${h.lyric ? '♪ ' : ''}${esc(h.t)}</span></a>`).join('')
        : `<div class="none" role="status">command not found: ${esc(q)}　試試 /help</div>`;
      input.setAttribute('aria-expanded', String(hits.length > 0));
      if (hits.length) input.setAttribute('aria-activedescendant', 'sh-cli-o' + sel); else input.removeAttribute('aria-activedescendant');
      out.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    const go = h => { if (!h) return; if (h.run) h.run(); else location.href = h.href; };
    function open(seed = '') {
      // 關掉的時候焦點回到打開前的地方 (膠囊按鈕、或按 / 之前停的那個)
      if (!box.classList.contains('open')) back = document.activeElement !== document.body ? document.activeElement : null;
      box.classList.add('open');
      input.value = seed;
      sel = 0;
      render();
      input.focus();
    }
    function close(restore = true) {
      if (!box.classList.contains('open')) return;
      box.classList.remove('open'); input.value = ''; render(); input.blur();
      if (restore && back?.isConnected) back.focus({ preventScroll: true });
      back = null;
    }
    const tap = () => coarse ? loadPhone().then(() => window.N247i.overlay()).catch(() => open()) : open();
    pill.addEventListener('click', tap);
    box.querySelector('.esc').addEventListener('click', () => close());
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
    // 點外面關掉: 焦點留在點下去的地方, 不拉回去
    document.addEventListener('pointerdown', e => { if (!box.contains(e.target)) close(false); }, { signal });
    window.__shellCli = { open };
  }

  /* ---------- 快捷鍵說明 (按 ?) ---------- */
  // 跳頁那幾組直接從選單來 (跟頁首同一份); 這一頁自己標出來。用 <dialog>: Esc 關、焦點留在裡面都是瀏覽器做的
  function buildHelp(idx) {
    if (document.querySelector('.sh-help')) return;
    const here = norm(location.pathname);
    const k = s => `<kbd>${esc(s)}</kbd>`;
    const row = (keys, what) => `<div class="row"><dt>${keys}</dt><dd>${what}</dd></div>`;
    const groups = idx.groups.map(g => `<section><h3>${esc(g.name)}</h3><dl>${g.items.map(it =>
      row(k(it.key), esc(it.name) + (norm(it.href) === here ? ' <i>這頁</i>' : ''))).join('')}</dl></section>`).join('');
    // 這一頁自己的鍵 (例如翻譯頁的 B / R / H), 頁面放在 window.__shellPageKeys, 打開的時候才讀
    const pageKeys = () => { const pk = window.__shellPageKeys; return pk ? `<section class="pg"><h3>${esc(pk.name)}</h3><dl>${pk.rows.map(([key, what]) => row(k(key), esc(what))).join('')}</dl></section>` : ''; };
    const d = document.createElement('dialog');
    d.className = 'sh-help';
    d.setAttribute('aria-label', '鍵盤快捷鍵');
    d.innerHTML = `<div class="sh-help-hd"><span><span class="u">guest@nishina</span>:<span class="pa">~</span> $ man keys</span>
        <button type="button" class="x" aria-label="關閉">esc</button></div>
      <div class="sh-help-grid">${groups}<!--page-->
        <section><h3>指令列</h3><dl>${row(k('/'), '打開, 搜歌名、跳頁')}${row(k('↑') + k('↓'), '選')}${row(k('Enter'), '前往')}${row(k('Esc'), '關掉')}</dl></section>
        <section><h3>其他</h3><dl>${row(k('?'), '這份說明')}${row(k('Esc'), '關掉跳出來的東西')}</dl></section>
      </div>
      <p class="sh-help-ft">在輸入框裡打字、或按著 ⌘ / Ctrl 的時候不會觸發</p>`;
    document.body.append(d);
    d.querySelector('.x').addEventListener('click', () => d.close());
    d.addEventListener('click', e => { if (e.target === d) d.close(); });   // 點旁邊的暗處關掉
    const grid = d.querySelector('.sh-help-grid'), base = grid.innerHTML;
    window.__shellHelp = { open: () => { if (d.open) return; grid.innerHTML = base.replace('<!--page-->', pageKeys()); d.showModal(); } };
  }

  // 單鍵: / 開指令列, 字母換頁。輸入中 / 修飾鍵 / 有對話框 (LiveStage、目錄抽屜、N247i) 開著時不動
  function wireKeys(idx) {
    const byKey = Object.fromEntries(allItems(idx).map(it => [it.key.toLowerCase(), it.href]));
    addEventListener('keydown', e => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t.isContentEditable || (t.closest && t.closest('input, textarea, select'))) return;
      if (window.__shellNoKeys || document.querySelector('dialog:modal')) return;   // 嵌在 N247i 電視裡的完整 Live 不吃站上的快捷鍵
      if (e.key === '/') { e.preventDefault(); window.__shellCli?.open(); return; }
      if (e.key === '?') { e.preventDefault(); window.__shellHelp?.open(); return; }
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
        if (planet && hero.dataset.orb !== 'off') orb(hero, planet);
      }
    }
    if (idx) { buildCli(idx); buildHelp(idx); }   // ClientRouter 換頁會換掉 body, 指令列、說明要重建 (自己防重複)
    if (idx && !window.__shellKeys) {
      window.__shellKeys = true;
      wireKeys(idx);
    }
  }

  // 加到主畫面 + 斷線時看過的頁還打得開 (規則見 /sw.js); 本機 astro dev 不註冊, 免得改了程式還吃到舊快取
  if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || window.__swTest) {
    addEventListener('load', () => navigator.serviceWorker?.register('/sw.js').catch(() => {}));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('astro:page-load', init);
})();
