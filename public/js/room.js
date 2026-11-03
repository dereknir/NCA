/* room.js — 首頁的房間 (樣式 /css/room.css, 圖 /img/room/*.png, 熱區座標寫在 RoomScene.astro)
 *
 * 房間是 480×270 的像素畫: 依畫面算一個倍率 --s, 對齊螢幕實體像素, 放大後每一格一樣大。
 * 直的螢幕塞不下就照高度放大、左右滑著看, 一開始停在手機那邊。
 * 熱區: 滑鼠滑過去四個角框起來, 名牌只寫點了會去哪; 觸控直接點就進去。
 * 手機 = 把網頁版 N247i 拿起來 (疊一層, 闔上就放回去); 電腦 = 指令列; しっぽ 點了會晃; 檯燈可以開關。
 * 海報 = 今日の一曲的封面 (跟 N247i 待受同一首), 用房間的色盤重畫; 月曆每天自己翻到今天, 圈下一場;
 * 書櫃上的鬧鐘是現在幾點 (2:47 / 14:47 會變粉紅)。
 * 天色: 照東京現在的太陽高度換白天 / 傍晚 / 晚上的房間 (第一張是 RoomScene 開頭那段 script 決定的, 這裡每 15 秒再看一次);
 * 白天的海報、月曆、鬧鐘跟著房間亮一階, 流星只有晚上才有。
 * 開場: 站在一樓的屋頂上, 二樓我房間的窗開著一條縫, 今天那首歌的歌詞從縫裡飄出來 (晚上飄過屋簷會變成一顆星);
 * 把外面那扇窗往右拉開 (拖、點、Enter), 拉到底停一下就直接切到房間裡。鏡頭不動, 沒有特效; Esc 直接進去。
 * 右下角的喇叭: 自己合成的 lo-fi, 隔著玻璃是悶的, 窗拉開一點清楚一點; 外面有風, 偶爾遠遠的平交道跟電車。
 */
(() => {
  const root = document.querySelector('[data-room]');
  if (!root) return;
  const pan = root.querySelector('.rm-pan'), stage = root.querySelector('.rm-stage'), tip = root.querySelector('.rm-tip');
  const shippo = stage.querySelector('.rm-shippo'), html = document.documentElement, sky = window.__room;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 480, H = 270, PHONE_X = 230;
  const v = (el, k) => +el.style.getPropertyValue('--' + k);

  /* ---------- 倍率 ---------- */
  let s = 1, panned = false, cur = null;   // cur: 現在亮名牌的熱區
  function fit() {
    const dpr = devicePixelRatio || 1, cw = pan.clientWidth, ch = pan.clientHeight;
    let k = cw < ch ? ch / H : Math.min(cw / W, ch / H);
    k = Math.max(1, Math.floor(k * dpr)) / dpr;
    s = k; stage.style.setProperty('--s', k);
    if (!panned && W * k > cw) { pan.scrollLeft = PHONE_X * k - cw / 2; panned = true; }
    if (cur) place(cur);
  }
  fit();
  addEventListener('resize', fit);

  /* ---------- 名牌 ---------- */
  function place(el) {
    const x = v(el, 'x') + v(el, 'w') / 2, y = v(el, 'y'), below = y < 40;
    tip.classList.toggle('below', below);
    tip.style.top = (below ? y + v(el, 'h') : y) * s + 'px';
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.min(Math.max(x * s, half), W * s - half) + 'px';
  }
  function showTip(el) {
    if (cur && cur !== el) cur.classList.remove('on');
    cur = el; el.classList.add('on');
    tip.textContent = el.dataset.sub;
    if (!el.dataset.sub) return tip.classList.remove('show');   // しっぽ 只框不寫
    place(el); tip.classList.add('show');
  }
  function hideTip() { if (cur) cur.classList.remove('on'); cur = null; tip.classList.remove('show'); }

  /* ---------- 點了之後 ---------- */
  const ACTS = { phone: pickUp, cli: () => window.__shellCli?.open(), shippo: swing, lamp: () => setLamp(!want.on), none() {} };
  stage.querySelectorAll('.rm-hs').forEach(el => {
    el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { showTip(el); if (el.dataset.act === 'shippo') swing(); } });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && cur === el) hideTip(); });
    el.addEventListener('focus', () => showTip(el));
    el.addEventListener('blur', () => { if (cur === el) hideTip(); });
    el.addEventListener('click', e => {
      const act = el.dataset.act;
      if (!act) return;   // 連結照常走
      e.preventDefault();
      ACTS[act](el);
    });
  });
  document.addEventListener('pointerdown', e => { if (cur && !e.target.closest('.rm-hs')) hideTip(); });

  function swing() {
    shippo.classList.remove('swing'); void shippo.offsetWidth; shippo.classList.add('swing');
  }
  shippo.addEventListener('animationend', () => shippo.classList.remove('swing'));

  /* ---------- 天色、檯燈: 換之前先把那一套圖載好, 換的時候才不會閃一下 ---------- */
  const bg = stage.querySelector('.rm-bg'), lampSpot = stage.querySelector('[data-k="lamp"]');
  const WHEN = { d: ['白天', '藍天和城市'], k: ['傍晚', '傍晚的天和月亮'], n: ['夜裡', '月亮和城市'] };
  let set = html.dataset.rmSet || 'n', lampOn = html.dataset.rmLamp !== 'off', want = { s: set, on: lampOn };
  const load = src => new Promise(ok => { const i = new Image(); i.onload = i.onerror = ok; i.src = src; });
  const ready = (st, on) => Promise.all(Object.values(sky.urls(st, on)).map(load));
  function go(st, on) {
    if (st === want.s && on === want.on) return;
    const w = want = { s: st, on };
    ready(st, on).then(() => { if (want === w) { sky.paint(st, on); set = st; lampOn = on; dress(); } });
  }
  function setLamp(on) {
    try { sessionStorage.setItem(want.s === 'd' ? 'rm-lamp-d' : 'rm-lamp-n', on ? 'on' : 'off'); } catch {}
    go(want.s, on);
  }
  // 圖以外跟著換的: 檯燈的名牌、讀螢幕用的說明、白天亮一階的海報月曆鬧鐘
  function dress() {
    lampSpot.dataset.sub = lampOn ? '關燈' : '開燈';
    if (cur === lampSpot) showTip(lampSpot);
    const [when, out] = WHEN[set];
    bg.setAttribute('aria-label', `${when}的房間: 書桌上有${lampOn ? '亮著的' : ''}檯燈、插在充電座上的折疊手機、CRT 電腦和收音機, 窗開著, 外面是${out}`);
    paintPoster(); drawCal(); tickClock();
    ready(set, !lampOn);   // 另一盞燈的圖先載好, 開關的時候馬上換
  }
  setInterval(() => { const st = sky.set(); if (st !== want.s) go(st, sky.lamp(st)); }, sky.speed > 1 ? 250 : 15000);

  /* ---------- 海報、月曆 (跟 N247i 待受畫面用同一份資料) ---------- */
  const jst = () => new Date(Date.now() + 9 * 36e5);
  const today = jst().toISOString().slice(0, 10), jstDay = Math.floor((Date.now() + 9 * 36e5) / 864e5);

  // 房間的色盤 (原圖 35 色), 海報重畫只用這些顏色
  const HEX = ['07060f', '0e0b1d', '161229', '1f1838', '2b2249', '3b335f', '0c1430', '142050', '22377a', '3f63a8', '8fb0e0', 'eef0d6',
    '24140f', '3a2219', '573424', '7a4b30', 'a3673b', 'c98d52', '6e2a2a', 'c4532a', 'f29b4a', 'ffd27a', 'fff3c4', '9d95c9', 'c9c3e6',
    'ece8ff', 'd9507a', '2c5b40', '7ee0b0', 'e8c94a', '5ca8ff', 'cfc2a4', '8f8270', '3e2a45', '5a3a48'];
  const PAL = HEX.map(h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)));
  // 白天: 每條色階往亮的那邊走一格, 跟白天那張房間圖同一張表 (沒在表上的顏色不變, 像螢幕、LED 自己會亮)
  const UP = {};
  for (const ramp of [['07060f', '0e0b1d', '161229', '1f1838', '2b2249', '3b335f', '9d95c9', 'c9c3e6', 'ece8ff'],
    ['24140f', '3a2219', '573424', '7a4b30', 'a3673b', 'c98d52'], ['3e2a45', '5a3a48', '8f8270', 'cfc2a4', 'eef0d6'],
    ['0c1430', '142050', '22377a', '3f63a8', '8fb0e0']]) ramp.forEach((c, i) => { UP['#' + c] = '#' + (ramp[i + 1] || c); });
  const lit = col => set === 'd' ? UP[col] || col : col;
  const UPI = HEX.map(h => HEX.indexOf((UP['#' + h] || '#' + h).slice(1)));   // 色盤第幾色 → 白天是第幾色
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  let posterIdx = null;   // 海報每一格是色盤的第幾色 (晚上的顏色)
  function drawPoster(song) {
    const spot = stage.querySelector('[data-k="poster"]');
    spot.href = `/live/full/${song.id}/`; spot.dataset.sub = `${song.title} · 完整 Live`;
    spot.setAttribute('aria-label', `今日の一曲: ${song.title} 的完整 Live`);
    if (!song.cover) return;
    const img = new Image();
    img.onload = () => {
      const c = stage.querySelector('.rm-poster'), x = c.getContext('2d', { willReadFrequently: true }), N = c.width;
      x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, N, N);
      const p = x.getImageData(0, 0, N, N).data;
      posterIdx = new Uint8Array(N * N);
      for (let i = 0; i < p.length; i += 4) {
        const k = i / 4, t = (BAYER[(k / N & 3) * 4 + (k % N & 3)] / 16 - .5) * 12;
        const r = p[i] * .8 + t, g = p[i + 1] * .8 + t, b = p[i + 2] * .88 + t;   // 夜裡的房間: 壓暗一點、偏冷
        let best = 0, bd = Infinity;
        PAL.forEach((q, n) => { const dr = r - q[0], dg = g - q[1], db = b - q[2], dd = 3 * dr * dr + 4 * dg * dg + 2 * db * db; if (dd < bd) { bd = dd; best = n; } });
        posterIdx[k] = best;
      }
      paintPoster(); c.classList.add('on');
    };
    img.src = song.cover;
  }
  function paintPoster() {
    if (!posterIdx) return;
    const c = stage.querySelector('.rm-poster'), x = c.getContext('2d', { willReadFrequently: true }), N = c.width;
    const im = x.createImageData(N, N), p = im.data;
    posterIdx.forEach((n, k) => { const q = PAL[set === 'd' ? UPI[n] : n]; p[k * 4] = q[0]; p[k * 4 + 1] = q[1]; p[k * 4 + 2] = q[2]; p[k * 4 + 3] = 255; });
    x.putImageData(im, 0, 0);
  }

  // 月曆: 照原圖的排法畫這個月 (5×7 像素字), 今天塗黃、過去的日子變淡、下一場用粉紅筆圈起來
  const FONT = { 0: '14171921251714', 1: '04120404040414', 2: '14170102040831', 3: '31020402011714', 4: '02061018310202', 5: '31163001011714',
    6: '06081630171714', 7: '31010204080808', 8: '14171714171714', 9: '14171715010212', A: '14171731171717', B: '30171730171730',
    C: '14171616161714', D: '30171717171730', E: '31161630161631', F: '31161630161616', G: '14171623171715', J: '07020202021812',
    L: '16161616161631', M: '17272121171717', N: '17172521191717', O: '14171717171714', P: '30171730161616', R: '30171730201817',
    S: '15161614010130', T: '31040404040404', U: '17171717171714', V: '17171717171004', Y: '17171004040404' };
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const RING = [[1, 0], [2, 0], [3, 0], [0, 1], [4, 1], [0, 2], [4, 2], [0, 3], [4, 3], [0, 4], [4, 4], [1, 5], [2, 5], [3, 5], [5, 0], [6, -1]];
  let next = null;   // 下一場
  function drawCal() {
    const c = stage.querySelector('.rm-cal'), x = c.getContext('2d');
    const dot = (px, py, col) => { x.fillStyle = lit(col); x.fillRect(px, py, 1, 1); };
    const box = (px, py, w, h, col) => { x.fillStyle = lit(col); x.fillRect(px, py, w, h); };
    const text = (str, px, py, col) => [...str].forEach((ch, n) => {
      const g = FONT[ch];
      for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (+g.slice(r * 2, r * 2 + 2) & (16 >> b)) dot(px + n * 6 + b, py + r, col);
    });
    const d = jst(), y = d.getUTCFullYear(), m = d.getUTCMonth(), t = d.getUTCDate();
    const start = new Date(Date.UTC(y, m, 1)).getUTCDay(), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const weeks = Math.ceil((start + days) / 7), rowH = weeks > 5 ? 6 : 7;
    box(0, 0, 44, 10, '#d9507a'); box(0, 10, 44, 1, '#8f8270'); box(0, 11, 44, 43, '#cfc2a4');
    text(String(m + 1), 3, 2, '#ece8ff'); text(MON[m], 24, 2, '#ece8ff');
    const tone = col => col === 0 ? '#c4532a' : col === 6 ? '#3f63a8' : '#5a3a48';
    for (let i = 0; i < 7; i++) box(3 + 6 * i, 13, 3, 1, tone(i));
    box(1, 15, 42, 1, '#8f8270');
    for (let r = 1; r < weeks; r++) for (let px = 1; px < 43; px += 2) dot(px, 16 + rowH * r, '#8f8270');
    const nd = next && +next.date.slice(0, 4) === y && +next.date.slice(5, 7) === m + 1 ? +next.date.slice(8) : 0;
    for (let day = 1; day <= days; day++) {
      const n = start + day - 1, col = n % 7, cx = 2 + 6 * col, cy = 17 + rowH * Math.floor(n / 7), w = day >= 10 ? 3 : 1;
      if (day === t) box(cx + 1, cy + 1, 5, 4, '#e8c94a');
      box(cx + (w === 3 ? 1 : 2), cy + 2, w, 2, day < t ? '#8f8270' : tone(col));
      if (day === nd) RING.forEach(([a, b]) => dot(cx + a, cy + b, '#d9507a'));
    }
    c.classList.add('on');
  }

  let todayLines = [];   // 今日の一曲的歌詞, 開場從窗縫飄出來的就是這首
  fetch('/n247i.json').then(r => r.json()).then(d => {
    next = (d.upcoming || []).find(e => e.date >= today) || null;
    const cal = stage.querySelector('[data-k="calendar"]');
    if (next) cal.dataset.sub = `Live 演出 · 下一場 ${+next.date.slice(5, 7)}/${+next.date.slice(8)}`;
    drawCal();
    const song = d.songs.length ? d.songs[jstDay % d.songs.length] : null;   // N247i 的今日の一曲也是這樣挑
    if (song) { drawPoster(song); todayLines = song.lines.filter(l => l.ja); }
  }).catch(() => {});

  /* ---------- 書櫃上的鬧鐘: 黑底綠字, 跟著現在的時間走 ---------- */
  const DIG = { 0: [7, 5, 5, 5, 7], 1: [1, 1, 1, 1, 1], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7], 4: [5, 5, 7, 1, 1],
    5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 1, 1, 1], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7] };   // 3×5 的七段數字
  const clock = stage.querySelector('.rm-clock'), cx = clock.getContext('2d');
  function tickClock() {
    const d = new Date(), hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    const col = mm === '47' && (hh === '02' || hh === '14') ? '#d9507a' : '#7ee0b0';   // にしな = 2:47
    cx.fillStyle = lit('#07060f'); cx.fillRect(0, 0, 25, 8); cx.fillStyle = col;
    [...hh, ':', ...mm].forEach((ch, i) => {
      const x0 = 4 + i * 4 - (i > 2 ? 2 : 0);
      if (ch === ':') { if (d.getSeconds() % 2 === 0) { cx.fillRect(x0, 2, 1, 1); cx.fillRect(x0, 4, 1, 1); } return; }
      DIG[ch].forEach((row, r) => { for (let b = 0; b < 3; b++) if (row & (4 >> b)) cx.fillRect(x0 + b, 1 + r, 1, 1); });
    });
    clock.classList.add('on');
  }
  setInterval(tickClock, 1000);
  dress();

  /* 直的螢幕一開始提示可以左右滑, 滑過就不用了 */
  pan.addEventListener('scroll', () => root.querySelector('.rm-swipe')?.remove(), { once: true, passive: true });

  /* ---------- 拿起手機 ---------- */
  function pickUp() {
    if (!window.N247i || document.querySelector('.rm-pick')) return;
    hideTip();
    document.activeElement?.blur();   // 焦點留在房間的熱區上, 手機不會搶按鍵 (Esc 放不下)
    const wrap = document.createElement('div'); wrap.className = 'rm-pick';
    const host = document.createElement('div');
    const put = document.createElement('button'); put.type = 'button'; put.className = 'rm-pick-x'; put.textContent = '放下';
    wrap.append(host, put); document.body.append(wrap);
    window.__scrollLockCount = (window.__scrollLockCount || 0) + 1;
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const phone = N247i.mount(host);
    // 掀開的手機約 640px 高, 畫面放不下就整支縮小
    const fitPhone = () => { host.style.zoom = ''; const k = Math.min(1, (innerHeight - 72) / host.offsetHeight, (innerWidth - 24) / host.offsetWidth); if (k < 1) host.style.zoom = k.toFixed(3); };
    let done = false;
    const close = () => {
      if (done) return; done = true;
      watch.disconnect(); removeEventListener('resize', fitPhone);
      wrap.remove();
      window.__scrollLockCount = Math.max(0, (window.__scrollLockCount || 1) - 1);
      document.documentElement.style.overflow = prevOverflow;
      const u = new URL(location.href);
      if (u.searchParams.has('n2')) { u.searchParams.delete('n2'); history.replaceState(history.state, '', u); }
    };
    // 手機自己闔上 (待受畫面按 Esc / 外殼的闔上) 就放回桌上
    const watch = new MutationObserver(() => { if (phone.isOpen()) fitPhone(); else setTimeout(close, 150); });
    watch.observe(phone.root, { attributes: true, attributeFilter: ['class'] });
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    put.addEventListener('click', close);
    if (!phone.isOpen()) phone.open();
    fitPhone(); addEventListener('resize', fitPhone);
  }
  // 分享出去的 ?n2=uta/<id> 這種連結: 直接拿起手機, 讓手機自己開到那一頁
  if (new URLSearchParams(location.search).has('n2')) pickUp();

  /* ---------- 窗外的流星 (晚上才有) ---------- */
  if (!still) {
    const panes = [...stage.querySelectorAll('.rm-sky')];
    const shoot = () => {
      setTimeout(shoot, 7000 + Math.random() * 11000);
      if (set !== 'n') return;
      const pane = panes[Math.random() * panes.length | 0], st = document.createElement('i');
      const x0 = 18 + Math.random() * (v(pane, 'w') - 18), y0 = Math.random() * v(pane, 'h') * .45;
      st.style.left = x0 * s + 'px'; st.style.top = y0 * s + 'px';
      pane.append(st);
      st.animate([{ translate: '0 0', opacity: 1 }, { translate: `${-26 * s}px ${13 * s}px`, opacity: 0 }],
        { duration: 700, easing: 'steps(9)' }).onfinish = () => st.remove();
    };
    setTimeout(shoot, 2500);
  }

  /* ---------- 聲音: 自己合成的 lo-fi。隔著玻璃是悶的 (低通), 窗拉開一點清楚一點, 進了房間才清楚 ---------- */
  const lofi = (() => {
    let ac = null, bus, lp, noise, long, amb, far, windG, rollG, on = false, step = 0, nextT = 0, timer = 0, nextTrain = 0, ajar = 0;
    let inside = !html.classList.contains('rm-intro');
    const SIX = 60 / 74 / 4, hz = m => 440 * 2 ** ((m - 69) / 12);
    const CH = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];   // Fmaj7 → Em7 → Dm7 → Cmaj7, 一個和弦一小節
    const BASS = [41, 40, 38, 36];
    const _ = null, MEL = [
      [72, _, _, 69, _, _, 67, _, 69, _, _, _, 64, _, _, _],
      [67, _, _, 64, _, _, 62, _, 64, _, 67, _, _, _, _, _],
      [65, _, _, 64, _, _, 62, _, 60, _, _, 62, _, _, _, _],
      [64, _, _, _, 62, _, 60, _, 59, _, _, _, 55, _, _, _]];
    const MUFFLED = 380, AJAR = 2200, OPEN = 12000;
    function build() {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1; lp.frequency.value = inside ? OPEN : MUFFLED + (AJAR - MUFFLED) * ajar;
      const master = ac.createGain(); master.gain.value = .55;
      bus = ac.createGain(); bus.connect(lp).connect(master).connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      long = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
      const l = long.getChannelData(0); for (let i = 0, b = 0; i < l.length; i++) { b = b * .97 + (Math.random() * 2 - 1) * .3; l[i] = b; }
      // 唱片的沙沙聲: 很稀的爆點
      const cb = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), c = cb.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = Math.random() < .0007 ? (Math.random() - .5) * 1.4 : (Math.random() - .5) * .02;
      const crackle = ac.createBufferSource(), cg = ac.createGain();
      crackle.buffer = cb; crackle.loop = true; cg.gain.value = .12; crackle.connect(cg).connect(bus); crackle.start();
      // 外面的聲音 (不被玻璃悶住): 風, 遠遠的平交道跟電車
      amb = ac.createGain(); amb.connect(ac.destination);
      far = ac.createBiquadFilter(); far.type = 'lowpass'; far.frequency.value = 1500; far.connect(amb);
      const ws = ac.createBufferSource(), wf = ac.createBiquadFilter();
      ws.buffer = long; ws.loop = true; wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = .6;
      windG = ac.createGain(); windG.gain.value = inside ? .012 : .02;
      ws.connect(wf).connect(windG).connect(amb); ws.start();
      // 拉窗: 鋁窗的滾輪在軌道上「ゴロゴロ」, 音量跟著速度
      const rs = ac.createBufferSource(), rf = ac.createBiquadFilter();
      rs.buffer = long; rs.loop = true; rf.type = 'bandpass'; rf.frequency.value = 850; rf.Q.value = 2.2;
      rollG = ac.createGain(); rollG.gain.value = 0; rs.connect(rf).connect(rollG).connect(ac.destination); rs.start();
      nextTrain = ac.currentTime + 18;
    }
    function env(t, vol, a, len) { const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + len); g.connect(bus); return g; }
    function keys(t, m, len, vol) {   // 電鋼琴: 正弦加一點點高八度的三角波, 每個音隨機偏一點點, 像舊錄音帶
      const g = env(t, vol, .012, len), o = ac.createOscillator(), o2 = ac.createOscillator(), g2 = ac.createGain();
      o.frequency.value = hz(m); o.detune.value = (Math.random() - .5) * 14;
      o2.type = 'triangle'; o2.frequency.value = hz(m) * 2; g2.gain.value = .12;
      o.connect(g); o2.connect(g2).connect(g); o.start(t); o2.start(t); o.stop(t + len); o2.stop(t + len);
    }
    function bass(t, m, len) { const g = env(t, .2, .01, len), o = ac.createOscillator(); o.frequency.value = hz(m); o.connect(g); o.start(t); o.stop(t + len); }
    function kick(t) {
      const g = env(t, .7, .004, .32), o = ac.createOscillator();
      o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(42, t + .12); o.connect(g); o.start(t); o.stop(t + .34);
    }
    function hiss(t, type, f, vol, len, to = bus) {
      const src = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noise; fl.type = type; fl.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + len);
      src.connect(fl).connect(g).connect(to); src.start(t, Math.random() * .5); src.stop(t + len + .02);
    }
    function play(n, t) {
      const bar = n >> 4, i = n & 15;
      if (i & 1) t += SIX * .22;   // 搖擺: 反拍晚一點點
      if (i === 0) { CH[bar].forEach(m => keys(t, m, SIX * 15, .045)); bass(t, BASS[bar], SIX * 6); }
      if (i === 10) bass(t, BASS[bar] + 7, SIX * 3);
      if (MEL[bar][i] != null && step % 128 < 64) keys(t, MEL[bar][i], SIX * 5, .055);   // 旋律一輪有一輪沒有, 聽久了不會膩
      if (i === 0 || i === 7 || i === 10) kick(t);
      if (i === 4 || i === 12) hiss(t, 'bandpass', 1800, .22, .16);
      if (!(i & 1)) hiss(t, 'highpass', 7000, i % 4 ? .025 : .045, .04);
    }
    function bell(t, vol) {   // 平交道的鐘「カンカン」
      for (const [f, g0] of [[700, 1], [1050, .55], [1400, .22]]) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * g0, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + .32);
        o.connect(g).connect(far); o.start(t); o.stop(t + .35);
      }
    }
    function train(t) {   // 鐘響一陣, 電車轟轟地過去, 鐵軌接縫「タタン」
      for (let i = 0; i < 14; i++) bell(t + i * .46, .004 + .018 * Math.sin(Math.PI * (i + .5) / 14));
      const t0 = t + 4.5, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = long; src.loop = true; f.type = 'lowpass'; f.frequency.value = 170;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.09, t0 + 2.5); g.gain.linearRampToValueAtTime(0, t0 + 6.5);
      src.connect(f).connect(g).connect(amb); src.start(t0); src.stop(t0 + 6.6);
      for (let j = 0; j < 7; j++) { const tt = t0 + .8 + j * .78; hiss(tt, 'lowpass', 220, .05, .07, amb); hiss(tt + .14, 'lowpass', 220, .04, .07, amb); }
    }
    function tick() {
      while (nextT < ac.currentTime + .15) { play(step % 64, nextT); step++; nextT += SIX; }
      if (ac.currentTime > nextTrain) { train(ac.currentTime + .1); nextTrain = ac.currentTime + 80 + Math.random() * 40; }
    }
    const ok = () => on && ac;
    return {
      toggle() {
        on = !on;
        if (on) { if (!ac) build(); ac.resume(); nextT = ac.currentTime + .08; timer = setInterval(tick, 25); }
        else { clearInterval(timer); ac.suspend(); }
        return on;
      },
      setOpen(f) { ajar = f; if (ac && !inside) lp.frequency.setTargetAtTime(MUFFLED + (AJAR - MUFFLED) * f, ac.currentTime, .05); },
      roll(vel) { if (ok()) rollG.gain.setTargetAtTime(Math.min(.1, vel * .045), ac.currentTime, .03); },
      seam(vel) { if (ok()) hiss(ac.currentTime, 'bandpass', 2600 + Math.random() * 900, .02 + vel * .03, .015, ac.destination); },   // 軌道的接縫
      stop() {   // 拉到底「コトン」
        if (!ok()) return;
        const t = ac.currentTime; rollG.gain.setTargetAtTime(0, t, .02);
        hiss(t, 'lowpass', 300, .16, .07, ac.destination); hiss(t, 'bandpass', 900, .05, .04, ac.destination);
      },
      inside() { inside = true; if (ac) { lp.frequency.setTargetAtTime(OPEN, ac.currentTime, .3); windG.gain.setTargetAtTime(.012, ac.currentTime, .6); } },
    };
  })();
  const snd = root.querySelector('.rm-snd');
  snd.addEventListener('click', () => snd.setAttribute('aria-pressed', lofi.toggle()));

  /* ---------- 開場: 站在一樓的屋頂上, 二樓我房間的窗開著一條縫 ---------- */
  const out = root.querySelector('.rm-out');
  if (html.classList.contains('rm-intro')) intro(); else out.remove();
  function intro() {
    const OW = 480, OH = 400;
    const ostage = out.querySelector('.rm-out-stage'), sash = out.querySelector('.rm-ol-sash'), grab = out.querySelector('.rm-grab');
    const lyr = out.querySelector('.rm-lyrics'), gfx = out.querySelector('.rm-ol-fx').getContext('2d');
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    let state = 'out', k = 1;
    pan.inert = true;   // 還站在窗外, Tab 不會跑到房間裡的東西上

    // 窗外的圖蓋滿畫面, 窗在正中間 (直的手機也是)
    function layout() {
      const r = root.getBoundingClientRect();
      k = Math.max(r.width / OW, r.height / OH);
      const ox = clamp(r.width / 2 - 240 * k, r.width - OW * k, 0), oy = clamp(r.height / 2 - 200 * k, r.height - OH * k, 0);
      out.style.setProperty('--k', k); ostage.style.translate = `${ox}px ${oy}px`;
      placeSash();
    }

    // 外面那扇窗往右拉: 8 = 原本開著的縫, 72 = 全開。拖的時候有點重, 像有摩擦的彈簧
    let off = 8, offT = 8, vel = 0, stuck = true, lastSeam = 8;
    const placeSash = () => { sash.style.translate = off * k + 'px 0'; };
    function stepSash(dt) {
      const d = clamp(offT, 8, 72) - off;
      if (Math.abs(d) < .05 && Math.abs(vel) < .01) { if (vel) { vel = 0; lofi.roll(0); } return; }
      vel += (d * .018 - vel * .22) * dt / 16;
      vel = clamp(vel, -1.6, 1.6);
      const prev = off; off = clamp(off + vel * dt / 16, 8, 72);
      if ((off === 72 && vel > 0) || (off === 8 && vel < 0)) { if (Math.abs(vel) > .25) lofi.stop(); vel = 0; }
      lofi.roll(Math.abs(off - prev) * 16 / dt);
      if (Math.abs(off - lastSeam) > 5) { lastSeam = off; lofi.seam(Math.min(1, Math.abs(vel))); }
      lofi.setOpen((off - 8) / 64); placeSash();
    }

    // 今天那首歌的歌詞: 從窗縫飄出來, 沿著牆往上; 晚上過了屋簷會變成一顆星
    const fxData = gfx.createImageData(OW, OH), fx32 = new Uint32Array(fxData.data.buffer), stars = [];
    const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(n => (n + .5) / 16), bay = (x, y) => BAY[(y & 3) * 4 + (x & 3)];
    const STAR = 0xffd6f0ee, STAR2 = 0xffe6c3c9;   // #eef0d6 / #c9c3e6 (ImageData 是 RGBA, 小端序倒過來寫)
    let drawn = false;
    function drawStars(t) {
      if (!stars.length && !drawn) return;
      fx32.fill(0);
      for (let i = stars.length - 1; i >= 0; i--) {
        const st = stars[i], age = t - st.born;
        if (age > 45000 || set !== 'n') { stars.splice(i, 1); continue; }
        if (age < 2000 && bay(st.x, st.y) > age / 2000) continue;               // 慢慢浮現
        if (age > 40000 && bay(st.x, st.y) < (age - 40000) / 5000) continue;    // 慢慢淡掉
        fx32[st.y * OW + st.x] = Math.sin(age * .003 + st.p) > .3 ? STAR : STAR2;
      }
      gfx.putImageData(fxData, 0, 0); drawn = stars.length > 0;
    }
    let li = 0, lyricT = 2600;
    function emitLyric() {
      if (!todayLines.length) return;
      const l = todayLines[li++ % todayLines.length], el = document.createElement('div');
      el.className = 'rm-lyric';
      el.append(document.createElement('b'), document.createElement('i'));
      el.firstChild.textContent = l.ja; el.lastChild.textContent = l.zh || '';
      lyr.append(el);
      const x0 = 167 + off * .5, xe = 185 + Math.random() * 120, ye = 58 + Math.random() * 40;
      const at = (x, y, z, o) => ({ left: x / OW * 100 + '%', top: y / OH * 100 + '%', opacity: o, transform: `translate(-50%, -50%) scale(${z})` });
      el.animate([at(x0, 214, .75, 0), at(x0 - 8, 196, .9, .85), at((x0 + xe) / 2 - 14, 150, .82, .75), at((x0 + xe * 2) / 3, 112, .66, .5), at(xe, ye, .35, 0)],
        { duration: 11000, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' }).onfinish = () => {
        el.remove();
        if (state === 'out' && set === 'n') stars.push({ x: Math.round(xe), y: Math.round(ye), born: performance.now(), p: Math.random() * 6 });
      };
    }

    // 進去: 鏡頭不動。窗拉到底、停一下, 直接切到房間裡 (房間裡的窗就是剛剛拉開的樣子)
    function openUp() {
      if (state !== 'out') return;
      if (still) return enterRoom();
      state = 'opening'; stuck = false; offT = 72;
      const wait = () => { if (state !== 'opening') return; if (off > 71.5) setTimeout(enterRoom, 420); else requestAnimationFrame(wait); };
      requestAnimationFrame(wait);
    }
    function enterRoom() {
      if (state === 'in') return;
      state = 'in';
      try { sessionStorage.setItem('rm-intro', '1'); } catch {}
      removeEventListener('resize', layout); removeEventListener('keydown', onKey);
      lofi.inside();
      out.remove(); html.classList.remove('rm-intro'); pan.inert = false;
    }

    // 拖 (往右)、點一下、Enter 都會拉開; Esc 直接進去
    let drag = null;
    grab.addEventListener('pointerdown', e => {
      if (state !== 'out') return;
      drag = { x: e.clientX, y: e.clientY, off, moved: 0 };
      grab.setPointerCapture(e.pointerId); grab.classList.add('drag');
    });
    grab.addEventListener('pointermove', e => {
      if (!drag) return;
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
      let to = drag.off + (e.clientX - drag.x) / k;
      if (stuck) { if (to - 8 < 3) to = 8; else { stuck = false; lofi.seam(1); } }   // 一開始卡卡的, 用點力才動
      offT = to;
    });
    grab.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag; drag = null; grab.classList.remove('drag');
      if (d.moved < 6 || off > 30) openUp(); else { offT = 8; stuck = true; }
    });
    grab.addEventListener('pointercancel', () => { if (drag) { drag = null; grab.classList.remove('drag'); offT = 8; stuck = true; } });
    grab.addEventListener('click', e => { if (e.detail === 0) openUp(); });   // 鍵盤按的
    const onKey = e => {
      if (e.target.closest?.('.rm-snd')) return;
      if ((e.key === 'Enter' || e.key === ' ') && state === 'out') { e.preventDefault(); openUp(); }
      else if (e.key === 'Escape' && state !== 'in') { e.preventDefault(); enterRoom(); }
    };

    let last = performance.now();
    function frame(t) {
      if (state === 'in') return;
      const dt = Math.min(50, t - last); last = t;
      stepSash(dt); drawStars(t);
      if (state === 'out' && !still && (lyricT += dt) > 5200) { lyricT = 0; emitLyric(); }
      requestAnimationFrame(frame);
    }
    layout();
    addEventListener('resize', layout);
    addEventListener('keydown', onKey);
    grab.focus({ preventScroll: true });
    requestAnimationFrame(frame);
  }
})();
