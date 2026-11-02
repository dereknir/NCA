/* room.js — 首頁的房間 (樣式 /css/room.css, 圖 /img/room/*.png, 熱區座標寫在 RoomScene.astro)
 *
 * 房間是 480×270 的像素畫: 依畫面算一個倍率 --s, 對齊螢幕實體像素, 放大後每一格一樣大。
 * 直的螢幕塞不下就照高度放大、左右滑著看, 一開始停在手機那邊。
 * 熱區: 滑鼠滑過去四個角框起來, 名牌只寫點了會去哪; 觸控直接點就進去。
 * 手機 = 把網頁版 N247i 拿起來 (疊一層, 闔上就放回去); 電腦 = 指令列; しっぽ 點了會晃; 檯燈可以開關 (記在瀏覽器)。
 * 海報 = 今日の一曲的封面 (跟 N247i 待受同一首), 用房間的色盤重畫; 月曆每天自己翻到今天, 圈下一場;
 * 書櫃上的鬧鐘是現在幾點 (2:47 / 14:47 會變粉紅)。
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
  fetch('/n247i.json').then(r => r.json()).then(d => {
    const next = (d.upcoming || []).find(e => e.date >= today), cal = stage.querySelector('[data-k="calendar"]');
    if (next) cal.dataset.sub = `Live 演出 · 下一場 ${+next.date.slice(5, 7)}/${+next.date.slice(8)}`;
    drawCal(next);
    const song = d.songs.length ? d.songs[jstDay % d.songs.length] : null;   // N247i 的今日の一曲也是這樣挑
    if (song) drawPoster(song);
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
})();
