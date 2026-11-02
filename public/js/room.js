/* room.js — 首頁的房間 (樣式 /css/room.css, 圖 /img/room/*.png, 熱區座標寫在 RoomScene.astro)
 *
 * 房間是 480×270 的像素畫: 依畫面算一個倍率 --s, 對齊螢幕實體像素, 放大後每一格一樣大。
 * 直的螢幕塞不下就照高度放大、左右滑著看, 一開始停在手機那邊。
 * 熱區: 滑鼠滑過去四個角框起來, 名牌只寫點了會去哪; 觸控直接點就進去。
 * 手機 = 把網頁版 N247i 拿起來 (疊一層, 闔上就放回去); 電腦 = 指令列; しっぽ 點了會晃; 檯燈可以開關 (記在瀏覽器)。
 * 海報 = 今日の一曲的封面 (跟 N247i 待受同一首), 用房間的色盤重畫; 月曆每天自己翻到今天, 圈下一場;
 * 書櫃上的鬧鐘是現在幾點 (2:47 / 14:47 會變粉紅)。
 * 開場: 走廊上虛掩的門, 門縫裡的房間亮到看不清, 光一路鋪到腳邊 (窗簾影子偶爾掃過、灰塵、今天那首歌的歌詞沿著光漂過來);
 * 壓下門把 → 門推開, 光淹滿畫面 → 眼睛慢慢適應, 看清房間 (Enter 開門, Esc 跳過)。
 * 右下角的喇叭: 自己合成的 lo-fi, 門關著的時候被門板悶住, 進了房間才清楚。
 */
(() => {
  const root = document.querySelector('[data-room]');
  if (!root) return;
  const pan = root.querySelector('.rm-pan'), stage = root.querySelector('.rm-stage'), tip = root.querySelector('.rm-tip');
  const shippo = stage.querySelector('.rm-shippo');
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
  const ACTS = { phone: pickUp, cli: () => window.__shellCli?.open(), shippo: swing, lamp: () => setLamp(!lampOn), none() {} };
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

  /* ---------- 檯燈 ---------- */
  const bg = stage.querySelector('.rm-bg'), ROOM_ON = bg.getAttribute('src'), ROOM_OFF = '/img/room/room-off.png';
  const lampSpot = stage.querySelector('[data-k="lamp"]');
  let lampOn = true;
  try { lampOn = localStorage.getItem('rm-lamp') !== 'off'; } catch {}
  function setLamp(on) {
    lampOn = on; bg.src = on ? ROOM_ON : ROOM_OFF; lampSpot.dataset.sub = on ? '關燈' : '開燈';
    try { localStorage.setItem('rm-lamp', on ? 'on' : 'off'); } catch {}
    if (cur === lampSpot) showTip(lampSpot);
  }
  if (!lampOn) setLamp(false); else new Image().src = ROOM_OFF;   // 先載好, 關燈的時候不會閃一下

  /* ---------- 海報、月曆 (跟 N247i 待受畫面用同一份資料) ---------- */
  const jst = () => new Date(Date.now() + 9 * 36e5);
  const today = jst().toISOString().slice(0, 10), jstDay = Math.floor((Date.now() + 9 * 36e5) / 864e5);

  // 房間的色盤 (原圖 35 色), 海報重畫只用這些顏色
  const PAL = ['07060f', '0e0b1d', '161229', '1f1838', '2b2249', '3b335f', '0c1430', '142050', '22377a', '3f63a8', '8fb0e0', 'eef0d6',
    '24140f', '3a2219', '573424', '7a4b30', 'a3673b', 'c98d52', '6e2a2a', 'c4532a', 'f29b4a', 'ffd27a', 'fff3c4', '9d95c9', 'c9c3e6',
    'ece8ff', 'd9507a', '2c5b40', '7ee0b0', 'e8c94a', '5ca8ff', 'cfc2a4', '8f8270', '3e2a45', '5a3a48'].map(h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)));
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function drawPoster(song) {
    const spot = stage.querySelector('[data-k="poster"]');
    spot.href = `/live/full/${song.id}/`; spot.dataset.sub = `${song.title} · 完整 Live`;
    spot.setAttribute('aria-label', `今日の一曲: ${song.title} 的完整 Live`);
    if (!song.cover) return;
    const img = new Image();
    img.onload = () => {
      const c = stage.querySelector('.rm-poster'), x = c.getContext('2d', { willReadFrequently: true }), N = c.width;
      x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, N, N);
      const im = x.getImageData(0, 0, N, N), p = im.data;
      for (let i = 0; i < p.length; i += 4) {
        const k = i / 4, t = (BAYER[(k / N & 3) * 4 + (k % N & 3)] / 16 - .5) * 12;
        const r = p[i] * .8 + t, g = p[i + 1] * .8 + t, b = p[i + 2] * .88 + t;   // 夜裡的房間: 壓暗一點、偏冷
        let best = PAL[0], bd = Infinity;
        for (const q of PAL) { const dr = r - q[0], dg = g - q[1], db = b - q[2], dd = 3 * dr * dr + 4 * dg * dg + 2 * db * db; if (dd < bd) { bd = dd; best = q; } }
        p[i] = best[0]; p[i + 1] = best[1]; p[i + 2] = best[2]; p[i + 3] = 255;
      }
      x.putImageData(im, 0, 0); c.classList.add('on');
    };
    img.src = song.cover;
  }

  // 月曆: 照原圖的排法畫這個月 (5×7 像素字), 今天塗黃、過去的日子變淡、下一場用粉紅筆圈起來
  const FONT = { 0: '14171921251714', 1: '04120404040414', 2: '14170102040831', 3: '31020402011714', 4: '02061018310202', 5: '31163001011714',
    6: '06081630171714', 7: '31010204080808', 8: '14171714171714', 9: '14171715010212', A: '14171731171717', B: '30171730171730',
    C: '14171616161714', D: '30171717171730', E: '31161630161631', F: '31161630161616', G: '14171623171715', J: '07020202021812',
    L: '16161616161631', M: '17272121171717', N: '17172521191717', O: '14171717171714', P: '30171730161616', R: '30171730201817',
    S: '15161614010130', T: '31040404040404', U: '17171717171714', V: '17171717171004', Y: '17171004040404' };
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const RING = [[1, 0], [2, 0], [3, 0], [0, 1], [4, 1], [0, 2], [4, 2], [0, 3], [4, 3], [0, 4], [4, 4], [1, 5], [2, 5], [3, 5], [5, 0], [6, -1]];
  function drawCal(next) {
    const c = stage.querySelector('.rm-cal'), x = c.getContext('2d');
    const dot = (px, py, col) => { x.fillStyle = col; x.fillRect(px, py, 1, 1); };
    const box = (px, py, w, h, col) => { x.fillStyle = col; x.fillRect(px, py, w, h); };
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

  drawCal(null);
  let todayLines = [];   // 今日の一曲的歌詞, 開場的門縫用
  fetch('/n247i.json').then(r => r.json()).then(d => {
    const next = (d.upcoming || []).find(e => e.date >= today), cal = stage.querySelector('[data-k="calendar"]');
    if (next) cal.dataset.sub = `Live 演出 · 下一場 ${+next.date.slice(5, 7)}/${+next.date.slice(8)}`;
    drawCal(next);
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
    cx.fillStyle = '#07060f'; cx.fillRect(0, 0, 25, 8); cx.fillStyle = col;
    [...hh, ':', ...mm].forEach((ch, i) => {
      const x0 = 4 + i * 4 - (i > 2 ? 2 : 0);
      if (ch === ':') { if (d.getSeconds() % 2 === 0) { cx.fillRect(x0, 2, 1, 1); cx.fillRect(x0, 4, 1, 1); } return; }
      DIG[ch].forEach((row, r) => { for (let b = 0; b < 3; b++) if (row & (4 >> b)) cx.fillRect(x0 + b, 1 + r, 1, 1); });
    });
    clock.classList.add('on');
  }
  tickClock(); setInterval(tickClock, 1000);

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

  /* ---------- 窗外的流星 ---------- */
  if (!still) {
    const panes = [...stage.querySelectorAll('.rm-sky')];
    const shoot = () => {
      const pane = panes[Math.random() * panes.length | 0], st = document.createElement('i');
      const x0 = 18 + Math.random() * (v(pane, 'w') - 18), y0 = Math.random() * v(pane, 'h') * .45;
      st.style.left = x0 * s + 'px'; st.style.top = y0 * s + 'px';
      pane.append(st);
      st.animate([{ translate: '0 0', opacity: 1 }, { translate: `${-26 * s}px ${13 * s}px`, opacity: 0 }],
        { duration: 700, easing: 'steps(9)' }).onfinish = () => st.remove();
      setTimeout(shoot, 7000 + Math.random() * 11000);
    };
    setTimeout(shoot, 2500);
  }
  /* ---------- 聲音: 自己合成的 lo-fi。門關著的時候被門板悶住 (低通), 進了房間才清楚 ---------- */
  const lofi = (() => {
    let ac = null, bus, lp, noise, on = false, step = 0, nextT = 0, timer = 0;
    let inside = !document.documentElement.classList.contains('rm-intro');
    const SIX = 60 / 74 / 4, hz = m => 440 * 2 ** ((m - 69) / 12);
    const CH = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];   // Fmaj7 → Em7 → Dm7 → Cmaj7, 一個和弦一小節
    const BASS = [41, 40, 38, 36];
    const _ = null, MEL = [
      [72, _, _, 69, _, _, 67, _, 69, _, _, _, 64, _, _, _],
      [67, _, _, 64, _, _, 62, _, 64, _, 67, _, _, _, _, _],
      [65, _, _, 64, _, _, 62, _, 60, _, _, 62, _, _, _, _],
      [64, _, _, _, 62, _, 60, _, 59, _, _, _, 55, _, _, _]];
    const MUFFLED = 380, LATCHED = 900, OPEN = 12000;
    function build() {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1; lp.frequency.value = inside ? OPEN : MUFFLED;
      const master = ac.createGain(); master.gain.value = .55;
      bus = ac.createGain(); bus.connect(lp).connect(master).connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // 唱片的沙沙聲: 很稀的爆點
      const cb = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), c = cb.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = Math.random() < .0007 ? (Math.random() - .5) * 1.4 : (Math.random() - .5) * .02;
      const crackle = ac.createBufferSource(), cg = ac.createGain();
      crackle.buffer = cb; crackle.loop = true; cg.gain.value = .12; crackle.connect(cg).connect(bus); crackle.start();
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
    function tick() { while (nextT < ac.currentTime + .15) { play(step % 64, nextT); step++; nextT += SIX; } }
    const to = (f, tc) => { if (ac) lp.frequency.setTargetAtTime(f, ac.currentTime, tc); };
    return {
      toggle() {
        on = !on;
        if (on) { if (!ac) build(); ac.resume(); nextT = ac.currentTime + .08; timer = setInterval(tick, 25); }
        else { clearInterval(timer); ac.suspend(); }
        return on;
      },
      // 壓門把: 門鎖「喀」一聲 (在門外, 不被悶住), 門鬆開一點, 裡面的聲音漏出來多一點
      latch() { if (!on) return; const t = ac.currentTime; hiss(t, 'bandpass', 2600, .5, .03, ac.destination); hiss(t + .07, 'bandpass', 1900, .35, .04, ac.destination); to(LATCHED, .05); },
      release() { if (on && !inside) to(MUFFLED, .1); },
      open() { inside = true; to(OPEN, .45); },
    };
  })();
  const snd = root.querySelector('.rm-snd');
  snd.addEventListener('click', () => snd.setAttribute('aria-pressed', lofi.toggle()));

  /* ---------- 開場: 走廊上虛掩的門 ---------- */
  const door = root.querySelector('.rm-door'), flood = root.querySelector('.rm-flood');
  if (door && document.documentElement.classList.contains('rm-intro')) intro();
  function intro() {
    const dstage = door.querySelector('.rm-door-stage'), img = door.querySelector('.rm-door-img'), knob = door.querySelector('.rm-knob');
    const lyr = door.querySelector('.rm-lyrics'), cv = door.querySelector('.rm-door-fx'), g = cv.getContext('2d');
    const FRAMES = [0, 1, 2, 3].map(i => `/img/room/door-${i}.png`);
    FRAMES.slice(1).forEach(src => { new Image().src = src; });
    const GAP = { x0: 255, x1: 290, y0: 20, y1: 166 };                        // 門縫 (走廊圖的座標)
    const BEAM = { y0: 167, y1: 269, l0: 255, l1: 214, r0: 292, r1: 372 };    // 地上那道光的四個角
    const xl = y => BEAM.l0 + (BEAM.l1 - BEAM.l0) * (y - BEAM.y0) / (BEAM.y1 - BEAM.y0);
    const xr = y => BEAM.r0 + (BEAM.r1 - BEAM.r0) * (y - BEAM.y0) / (BEAM.y1 - BEAM.y0);
    const DEPTH = .85, LOOK = [160, 135];   // 房間在門後比門小一點; 門縫正對房間的這一點 (檯燈附近)
    let k = 1, dx = 0, dy = 0, opening = false;

    // 走廊圖蓋滿畫面, 以門跟地上那道光為中心 (直的螢幕也是); 房間擺在門後
    function layout() {
      const r = root.getBoundingClientRect();
      k = Math.max(r.width / W, r.height / H);
      dx = Math.min(0, Math.max(r.width - W * k, r.width / 2 - 262 * k));
      dy = Math.min(0, Math.max(r.height - H * k, r.height / 2 - 135 * k));
      Object.assign(dstage.style, { left: dx + 'px', top: dy + 'px', width: W * k + 'px', height: H * k + 'px', translate: 'none' });
      root.style.setProperty('--k', k);
      stage.style.transformOrigin = '0 0'; stage.style.transform = 'none';
      const base = stage.getBoundingClientRect(), z = k * DEPTH / s;
      stage.style.transform = `translate(${r.left + dx + (GAP.x0 + GAP.x1) / 2 * k - base.left - LOOK[0] * s * z}px, ${r.top + dy + 93 * k - base.top - LOOK[1] * s * z}px) scale(${z})`;
    }

    // 影子跟灰塵畫在 480×270 的 canvas 上, 一格就是走廊圖的一格
    const im = g.createImageData(W, H), px = im.data;
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(n => (n + .5) / 16);
    const put = (x, y, r, gg, b, a) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = gg; px[i + 2] = b; px[i + 3] = a; };
    // 窗簾影子: 隔一陣子, 房間裡的窗簾被風吹到燈前面, 影子從光的一邊掃進來, 停一下又退回去
    const sw = { t: 0, dur: 0, peak: 0, side: 1, wait: 2400 };
    function shadow(dt) {
      if (!sw.dur) { sw.wait -= dt; if (sw.wait <= 0) Object.assign(sw, { t: 0, dur: 3400 + Math.random() * 1800, peak: .3 + Math.random() * .4, side: Math.random() < .6 ? -1 : 1 }); return; }
      sw.t += dt;
      if (sw.t >= sw.dur) { sw.dur = 0; sw.wait = 6000 + Math.random() * 7000; return; }
      const e = -.15 + (sw.peak + .15) * Math.sin(Math.PI * sw.t / sw.dur) ** 1.4, PEN = .1;
      const amt = (u, y) => {
        if (sw.side > 0) u = 1 - u;
        const w = e + .025 * Math.sin(y * .11 + sw.t / 260) + .015 * Math.sin(y * .37 - sw.t / 170);   // 布的皺褶, 邊緣有點波浪
        return u < w - PEN ? 1 : u > w ? 0 : (w - u) / PEN;
      };
      for (let y = GAP.y0; y <= GAP.y1; y++) for (let x = GAP.x0; x <= GAP.x1; x++)
        if (amt((x - GAP.x0) / (GAP.x1 - GAP.x0), y) > BAYER[(y & 3) * 4 + (x & 3)]) put(x, y, 87, 52, 36, 170);
      for (let y = BEAM.y0 + 1; y <= BEAM.y1; y++) {
        const l = Math.round(xl(y)), r = Math.round(xr(y));
        for (let x = l; x <= r; x++) if (amt((x - l) / (r - l), y) > BAYER[(y & 3) * 4 + (x & 3)]) put(x, y, 14, 11, 29, 150);
      }
    }
    // 灰塵: 浮在門縫跟地上那道光之間的空氣裡, 靠門縫的比較亮
    const mote = any => {
      const py = 34 + Math.random() * 132, qy = 170 + Math.random() * 99, f = Math.random();
      const px0 = GAP.x0 + Math.random() * (GAP.x1 - GAP.x0), qx = xl(qy) + Math.random() * (xr(qy) - xl(qy));
      return { x: px0 + f * (qx - px0), y: py + f * (qy - py), vx: (Math.random() - .5) * .035, vy: (Math.random() - .5) * .03 - .006,
        life: any ? Math.random() * 500 : 0, max: 300 + Math.random() * 500, b: 1 - f * .55, warm: Math.random() < .4 };
    };
    const motes = Array.from({ length: 90 }, () => mote(true));
    function dust(dt, t) {
      motes.forEach((m, i) => {
        m.life += dt / 16; m.x += m.vx * dt / 16 + Math.sin((t + i * 300) / 900) * .012; m.y += m.vy * dt / 16;
        const x = Math.round(m.x), y = Math.round(m.y);
        if (m.life > m.max || x < 0 || x >= W || y < 0 || y >= H) return (motes[i] = mote(false));
        let a = Math.sin(Math.PI * m.life / m.max) * m.b * (.55 + .45 * Math.sin((t + i * 97) / 380));
        if (px[(y * W + x) * 4 + 3]) a *= .25;   // 在影子裡就暗下去
        if (a > .08) put(x, y, 255, m.warm ? 210 : 243, m.warm ? 122 : 196, Math.min(255, a * 255) | 0);
      });
    }
    // 歌詞: 從門縫底下出發, 沿著地上的光往畫面前面漂, 越近越大
    let li = 0, lyricTimer = 2600;
    function emitLyric() {
      if (!todayLines.length) return;
      const l = todayLines[li++ % todayLines.length], el = document.createElement('div');
      el.className = 'rm-lyric';
      el.append(document.createElement('b'), document.createElement('i'));
      el.firstChild.textContent = l.ja; el.lastChild.textContent = l.zh || '';
      lyr.append(el);
      const at = (y, z, o) => ({ left: ((xl(y) + xr(y)) / 2 / W * 100) + '%', top: (y / H * 100) + '%', opacity: o, transform: `translate(-50%, -100%) scale(${z})` });
      el.animate([at(171, .3, 0), at(186, .5, .9), at(232, 1, .8), at(268, 1.45, 0)], { duration: 9000, easing: 'linear', fill: 'forwards' }).onfinish = () => el.remove();
    }
    let t = 0, last = performance.now();
    function frame(now) {
      if (opening) return g.clearRect(0, 0, W, H);
      const dt = Math.min(50, now - last); last = now; t += dt;
      px.fill(0); shadow(dt); dust(dt, t); g.putImageData(im, 0, 0);
      if ((lyricTimer += dt) > 4600) { lyricTimer = 0; emitLyric(); }
      requestAnimationFrame(frame);
    }

    const onKey = e => {
      if (e.target.closest?.('.rm-snd')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(false); }
      else if (e.key === 'Escape') { e.preventDefault(); open(true); }
    };
    layout();
    if (!still) requestAnimationFrame(frame);
    addEventListener('resize', layout);
    addEventListener('keydown', onKey);
    knob.addEventListener('pointerdown', () => { if (!opening) { img.src = FRAMES[1]; lofi.latch(); } });   // 壓下去那一格
    knob.addEventListener('pointerleave', () => { if (!opening) { img.src = FRAMES[0]; lofi.release(); } });
    knob.addEventListener('click', () => open(false));
    knob.focus({ preventScroll: true });

    function open(skip) {
      if (opening) return;
      opening = true;
      try { sessionStorage.setItem('rm-door', '1'); } catch {}
      removeEventListener('resize', layout); removeEventListener('keydown', onKey);
      lyr.textContent = ''; lofi.open();
      const done = () => {
        [pan, door].forEach(el => el.getAnimations().forEach(a => a.cancel()));
        pan.style.transformOrigin = ''; stage.style.transform = ''; stage.style.transformOrigin = '';
        door.remove(); document.documentElement.classList.remove('rm-intro');
      };
      if (skip || still) { flood.remove(); return done(); }
      door.classList.add('opening');
      img.src = FRAMES[1];
      setTimeout(() => { img.src = FRAMES[2]; }, 200);
      setTimeout(() => { img.src = FRAMES[3]; }, 380);
      // 往門口走進去 (房間跟走廊一起朝門縫放大), 光越來越亮, 白到底的那一刻換成房間
      const o = `${dx + 273 * k}px ${dy + 100 * k}px`;
      [pan, door].forEach(el => {
        el.style.transformOrigin = o;
        el.animate([{ transform: 'scale(1)' }, { transform: 'scale(2.2)' }], { duration: 1050, easing: 'cubic-bezier(.45,0,.75,1)', fill: 'forwards' });
      });
      flood.animate([{ opacity: 0 }, { opacity: .25, offset: .45 }, { opacity: 1 }], { delay: 120, duration: 900, easing: 'ease-in', fill: 'forwards' }).onfinish = () => {
        done();
        // 眼睛適應: 一開始整間房間亮到發白、糊糊的, 慢慢才看得清楚
        stage.animate([
          { filter: 'brightness(2.8) saturate(.25) contrast(.6) blur(4px)' },
          { filter: 'brightness(1.7) saturate(.55) contrast(.8) blur(1.5px)', offset: .3 },
          { filter: 'brightness(1.15) saturate(.9) contrast(.95) blur(.3px)', offset: .65 },
          { filter: 'brightness(1) saturate(1) contrast(1) blur(0px)' }], { duration: 3400, easing: 'ease-out' });
        flood.style.display = 'block';   // rm-intro 拿掉之後 CSS 會把它藏起來, 淡完才移掉
        flood.animate([{ opacity: 1 }, { opacity: 1, offset: .12 }, { opacity: 0 }], { duration: 1500, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' })
          .onfinish = () => flood.remove();   // 白到底先停一下, 像被光閃到
      };
    }
  }
})();
