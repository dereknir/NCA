/* room.js — 首頁的房間 (樣式 /css/room.css, 圖 /img/room/*.png, 熱區座標寫在 RoomScene.astro)
 *
 * 房間是 480×270 的像素畫: 依畫面算一個倍率 --s, 對齊螢幕實體像素, 放大後每一格一樣大。
 * 直的螢幕塞不下就照高度放大、左右滑著看, 一開始停在手機那邊。
 * 熱區: 滑鼠滑過去出現名牌; 觸控裝置第一下先看名牌, 再點一下才進去。
 * 手機 = 把網頁版 N247i 拿起來 (疊一層, 闔上就放回去); 電腦 = 指令列; しっぽ 點了會晃。
 */
(() => {
  const root = document.querySelector('[data-room]');
  if (!root) return;
  const pan = root.querySelector('.rm-pan'), stage = root.querySelector('.rm-stage'), tip = root.querySelector('.rm-tip');
  const shippo = stage.querySelector('.rm-shippo');
  const coarse = matchMedia('(pointer: coarse)').matches;
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
    tip.querySelector('b').textContent = el.dataset.name;
    tip.querySelector('i').textContent = el.dataset.sub;
    place(el); tip.classList.add('show');
  }
  function hideTip() { if (cur) cur.classList.remove('on'); cur = null; tip.classList.remove('show'); }

  /* ---------- 點了之後 ---------- */
  const ACTS = { phone: pickUp, cli: () => window.__shellCli?.open(), shippo: swing, none() {} };
  let armed = true;
  stage.querySelectorAll('.rm-hs').forEach(el => {
    el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { showTip(el); if (el.dataset.act === 'shippo') swing(); } });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && cur === el) hideTip(); });
    el.addEventListener('pointerdown', e => { armed = e.pointerType === 'mouse' || cur === el; });
    el.addEventListener('focus', () => showTip(el));
    el.addEventListener('blur', () => { if (cur === el) hideTip(); });
    el.addEventListener('click', e => {
      if (coarse && !armed) { e.preventDefault(); showTip(el); armed = true; return; }   // 觸控: 第一下先看名牌
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

  /* 月曆的名牌寫下一場 (跟 N247i 待受畫面用同一份資料) */
  fetch('/n247i.json').then(r => r.json()).then(d => {
    const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
    const next = (d.upcoming || []).find(e => e.date >= today), cal = stage.querySelector('[data-k="calendar"]');
    if (next && cal) cal.dataset.sub = `下一場 ${+next.date.slice(5, 7)}/${+next.date.slice(8)} ${next.venue}`;
  }).catch(() => {});

  /* 底下的提示: 點了捲到一般版首頁 */
  root.querySelector('.rm-hint')?.addEventListener('click', e => {
    e.preventDefault();
    scrollTo({ top: scrollY + root.getBoundingClientRect().bottom - 56, behavior: still ? 'auto' : 'smooth' });
  });

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
