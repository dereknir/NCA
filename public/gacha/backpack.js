/**
 * public/gacha/backpack.js — RPG 收集冊背包元件(照 backpack-spec.md)
 * 純 vanilla ES module。不 fetch、不碰 localStorage、不含抽卡邏輯。
 * 用法: const bp = createBackpack(el, opts); bp.refresh(log); bp.highlightLatest(identity);
 */

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  .bp{font-family:inherit;display:flex;flex-direction:column;gap:10px}
  .bp.chrome{background:var(--panel,#141d31);border:1px solid var(--line,#243154);
      border-radius:8px;padding:14px}
  .bp-tabs{display:flex;gap:8px;flex-wrap:wrap}
  .bp-tab{border:1px solid var(--line,#243154);border-radius:8px;padding:7px 14px;
      font-size:13px;color:var(--dim,#8b97b8);cursor:pointer;background:transparent;
      font-family:inherit;position:relative}
  .bp-tab:not(.locked):hover{text-decoration:underline;
      text-decoration-color:var(--accent,#3d63ff);text-underline-offset:4px}
  .bp-tab.active{background:var(--accent,#3d63ff);color:#fff;border-color:var(--accent,#3d63ff)}
  .bp-tab.locked{opacity:.4;cursor:not-allowed}
  .bp-tab .bp-count{font-size:11px;opacity:.85;margin-left:6px;font-variant-numeric:tabular-nums}
  .bp-pager{display:flex;align-items:center;justify-content:center;gap:12px;padding:0 2px;user-select:none}
  .bp-pager button{background:var(--panel-2,#1a2440);color:var(--text,#e8ecf6);
      border:1px solid var(--line,#243154);border-radius:8px;width:34px;height:34px;
      font-size:15px;cursor:pointer;font-family:inherit;transition:filter .15s,border-color .15s;
      display:flex;align-items:center;justify-content:center}
  .bp-pager button:not(:disabled):hover{border-color:var(--accent,#3d63ff);filter:brightness(1.15)}
  .bp-pager button:disabled{opacity:.3;cursor:not-allowed}
  .bp-pager .bp-p-num{font-size:12px;color:var(--dim,#8b97b8);font-variant-numeric:tabular-nums;
      min-width:70px;text-align:center}
  .bp-grid-wrap{border-radius:4px;transition:opacity .2s,transform .2s}
  .bp.switching .bp-grid-wrap{opacity:0;transform:translateX(6px)}
  .bp-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}
  .bp.narrow .bp-grid{grid-template-columns:repeat(4,1fr)}
  .bp-slot{aspect-ratio:4/3;border:1px solid var(--line,#243154);border-radius:3px;
      background:var(--panel-2,#1a2440);position:relative;overflow:hidden;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      background-size:cover;background-position:center;image-rendering:pixelated}
  .bp-slot.empty{opacity:.35}
  .bp-slot.empty .bp-q{font-size:16px;color:var(--dim,#8b97b8)}
  .bp-slot.owned{cursor:pointer;opacity:1}
  .bp-slot.owned:hover{transform:translateY(-2px);filter:brightness(1.1)}
  .bp-slot.r-N{border-color:var(--line,#243154)}
  .bp-slot.r-R{border-color:var(--accent,#3d63ff);border-width:2px}
  .bp-slot.r-SR,.bp-slot.r-LIVE{border-color:var(--gold,#e8c94a);border-width:2px}
  .bp-slot .bp-title{font-size:8px;line-height:1.3;color:var(--text,#e8ecf6);
      text-align:center;padding:0 3px;word-break:break-all;
      font-family:'JP8','JP12',monospace}
  .bp-slot .bp-line{font-size:9px;color:rgba(255,255,255,.6);margin-top:3px;
      font-family:monospace}
  /* 有 pixel-art 縮圖時, 隱藏 fallback 文字, 只留角落標 */
  .bp-slot.has-art .bp-title,.bp-slot.has-art .bp-line{display:none}
  .bp-slot .bp-live{position:absolute;top:2px;left:2px;font-size:7px;
      color:var(--gold,#e8c94a);font-family:monospace;letter-spacing:.5px;
      background:rgba(10,10,21,.65);padding:0 3px;border-radius:2px}
  .bp-slot .bp-dup{position:absolute;right:2px;bottom:2px;font-size:9px;
      color:rgba(255,255,255,.9);font-family:monospace;
      background:rgba(10,10,21,.65);padding:0 3px;border-radius:2px}
  .bp-slot.filling{animation:bp-fill .25s cubic-bezier(.2,1.6,.4,1)}
  @keyframes bp-fill{0%{transform:scale(.6);opacity:0}100%{transform:none;opacity:1}}
  .bp-slot.latest{box-shadow:0 0 0 2px var(--gold,#e8c94a);
      animation:bp-pulse 1s ease-in-out 3}
  @keyframes bp-pulse{0%,100%{box-shadow:0 0 0 2px var(--gold,#e8c94a)}
      50%{box-shadow:0 0 0 4px var(--gold,#e8c94a),0 0 14px 2px rgba(232,201,74,.5)}}
  @media (prefers-reduced-motion: reduce){
    .bp *{animation:none!important;transition:none!important;transform:none!important}
  }`;
  const el = document.createElement('style');
  el.dataset.backpack = '1';
  el.textContent = css;
  document.head.appendChild(el);
}

const artistOf = songId => songId.split('-')[0];

export function createBackpack(container, opts) {
  injectStyle();
  const state = {
    active: opts.activeArtist,
    log: opts.log || [],
    slotEls: new Map(),          // identityId (on current page) -> element
    ro: null,
    page: 0,
    pageSize: opts.pageSize ?? 24,
  };

  const root = document.createElement('div');
  root.className = 'bp' + (opts.chromeless ? '' : ' chrome');
  root.innerHTML =
    `<div class="bp-tabs"></div>` +
    `<div class="bp-pager"></div>` +
    `<div class="bp-grid-wrap"><div class="bp-grid"></div></div>`;
  container.appendChild(root);
  const tabsEl = root.querySelector('.bp-tabs');
  const pagerEl = root.querySelector('.bp-pager');
  const wrapEl = root.querySelector('.bp-grid-wrap');
  const gridEl = root.querySelector('.bp-grid');

  /* ---- 收集統計 ---- */
  function ownedMap(artistId) {
    // identityId -> { count, latest: logEntry }
    const m = new Map();
    for (const e of state.log) {
      if (artistOf(e.id) !== artistId) continue;
      const cur = m.get(e.id);
      if (cur) { cur.count++; if (e.ts >= cur.latest.ts) cur.latest = e; }
      else m.set(e.id, { count: 1, latest: e });
    }
    return m;
  }

  /* ---- Tabs ---- */
  function renderTabs() {
    if (opts.showTabs === false) { tabsEl.style.display = 'none'; return; }
    tabsEl.innerHTML = '';
    for (const a of opts.artists) {
      const btn = document.createElement('button');
      btn.className = 'bp-tab' + (a.locked ? ' locked' : '') + (a.id === state.active ? ' active' : '');
      const owned = a.locked ? 0 : ownedMap(a.id).size;
      btn.innerHTML = a.locked
        ? `\u{1F512} ${a.displayName}`
        : `${a.displayName}<span class="bp-count">${owned}/${a.totalCards}</span>`;
      if (!a.locked) btn.onclick = () => {
        if (a.id === state.active) return;
        setActive(a.id);
        opts.onTabSwitch && opts.onTabSwitch(a.id);
      };
      tabsEl.appendChild(btn);
    }
  }

  /* ---- Identities (該歌手全部 slot 的 flat 順序清單, 分頁前的來源) ---- */
  function currentIdentities() {
    const songs = opts.getSongsForArtist(state.active) || [];
    const list = [];
    for (const s of songs) for (const l of s.lines) list.push({ song: s, line: l });
    return list;
  }

  /* ---- Pager ---- */
  function renderPager(total) {
    const pageSize = state.pageSize;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    if (pages <= 1) { pagerEl.innerHTML = ''; pagerEl.style.display = 'none'; return; }
    pagerEl.style.display = 'flex';
    const start = state.page * pageSize + 1;
    const end = Math.min(total, (state.page + 1) * pageSize);
    pagerEl.innerHTML =
      `<button class="bp-p-btn" data-dir="-1" aria-label="上一頁" ${state.page === 0 ? 'disabled' : ''}>&lsaquo;</button>` +
      `<span class="bp-p-num">${start}–${end} / ${total}</span>` +
      `<button class="bp-p-btn" data-dir="1" aria-label="下一頁" ${state.page >= pages - 1 ? 'disabled' : ''}>&rsaquo;</button>`;
    pagerEl.querySelectorAll('.bp-p-btn').forEach(b => {
      b.onclick = () => {
        const next = state.page + Number(b.dataset.dir);
        if (next < 0 || next >= pages) return;
        state.page = next;
        renderGrid();
      };
    });
  }

  /* ---- Grid (每次只畫當前頁) ---- */
  function renderGrid(animateNew = false) {
    const list = currentIdentities();
    const owned = ownedMap(state.active);
    const start = state.page * state.pageSize;
    const pageItems = list.slice(start, start + state.pageSize);
    gridEl.innerHTML = '';
    state.slotEls.clear();
    const frag = document.createDocumentFragment();
    for (const { song, line } of pageItems) {
      const id = `${song.id}#${line.i}`;
      const got = owned.get(id);
      const el = document.createElement('div');
      el.dataset.id = id;
      if (!got) {
        el.className = 'bp-slot empty';
        el.innerHTML = `<div class="bp-q">?</div>`;
      } else {
        const r = got.latest.rarity;
        const identity = { song, line, rarity: r, seed: got.latest.seed };
        // 優先要真實 pixel-art 縮圖; 沒有(或呼叫失敗)才 fallback 到 accent + 文字
        let artUrl = null;
        if (opts.renderSlotArt) {
          try { artUrl = opts.renderSlotArt(identity); } catch (e) { artUrl = null; }
        }
        el.className = `bp-slot owned r-${r}` + (animateNew ? ' filling' : '') + (artUrl ? ' has-art' : '');
        if (artUrl) {
          el.style.backgroundImage = `url(${artUrl})`;
        } else {
          el.style.background = hexDim(song.accent);
        }
        el.innerHTML =
          (r === 'LIVE' ? `<div class="bp-live">LIVE</div>` : '') +
          (artUrl ? '' :
            `<div class="bp-title">${esc([...song.title].slice(0, 6).join(''))}</div>` +
            `<div class="bp-line">#${line.i}</div>`) +
          (got.count > 1 ? `<div class="bp-dup">×${got.count}</div>` : '');
        el.onclick = () => opts.onSlotClick && opts.onSlotClick(identity);
      }
      state.slotEls.set(id, el);
      frag.appendChild(el);
    }
    gridEl.appendChild(frag);
    renderPager(list.length);
  }

  /* ---- 導頁到某 identity 所在頁, 回傳該 slot element (若不在該歌手池 → null) ---- */
  function pageIndexOf(identity) {
    if (artistOf(identity.song.id) !== state.active) return -1;
    const id = `${identity.song.id}#${identity.line.i}`;
    const list = currentIdentities();
    return list.findIndex(({ song, line }) => `${song.id}#${line.i}` === id);
  }
  function showIdentity(identity) {
    const idx = pageIndexOf(identity);
    if (idx < 0) return null;
    const targetPage = Math.floor(idx / state.pageSize);
    if (targetPage !== state.page) {
      state.page = targetPage;
      renderGrid();
    }
    return state.slotEls.get(`${identity.song.id}#${identity.line.i}`) || null;
  }

  function hexDim(hex) {
    const v = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
    return `rgb(${Math.round(r * 0.32 + 12)},${Math.round(g * 0.32 + 15)},${Math.round(b * 0.32 + 24)})`;
  }
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---- API ---- */
  function setActive(artistId) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.active = artistId;
    state.page = 0;
    if (reduced) { renderTabs(); renderGrid(); return; }
    root.classList.add('switching');
    setTimeout(() => {
      renderTabs(); renderGrid();
      root.classList.remove('switching');
    }, 200);
  }

  function refresh(newLog) {
    state.log = newLog || state.log;
    renderTabs();
    renderGrid(true);
  }

  function highlightLatest(identity) {
    // 先跳頁到 identity 所在頁, 再加 latest pulse
    const el = showIdentity(identity);
    if (!el) return;
    for (const other of state.slotEls.values()) other.classList.remove('latest');
    el.classList.add('latest');
  }

  function destroy() {
    state.ro && state.ro.disconnect();
    root.remove();
  }

  /* ---- 響應式(以容器寬決定欄數) ---- */
  state.ro = new ResizeObserver(entries => {
    for (const e of entries)
      root.classList.toggle('narrow', e.contentRect.width < 640);
  });
  state.ro.observe(container);

  renderTabs();
  renderGrid();
  return { highlightLatest, refresh, setActive, destroy, showIdentity };
}
