/* n247i.js — 像素ガラケー N247i (樣式 /css/n247i.css, 資料 /n247i.json)
 *
 *   N247i.mount(el)     首頁 hero: 一開始闔著 (外面小螢幕跑今日の一曲, 有新信就閃燈), 點一下掀開
 *   N247i.overlay()     手機上的導航: 疊在整頁上, 直接開在 MENU (site-shell 的指令列按鈕在觸控裝置上會叫這個)
 *
 * にしな = に・し・な = 2・4・7: 機型 N247i、鍵盤 2 4 7 的假名是「に し な」、撥 247 會打給にしな (電話帳裡也有),
 * 2:47 / 14:47 待受的時鐘會變金色。新着メール一天最多一封 (讀過就記在瀏覽器)。
 */
(function () {
  if (window.N247i) return;
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const jstDay = () => Math.floor((Date.now() + 9 * 36e5) / 864e5);
  const jstDate = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const is247 = d => (d.getHours() === 2 || d.getHours() === 14) && d.getMinutes() === 47;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  let dataP = null;
  const loadData = () => dataP || (dataP = fetch('/n247i.json').then(r => r.json()).catch(() => ({ songs: [], upcoming: [] })));

  /* ---------- 像素小圖示 ---------- */
  function bitmap(c, rows, color) {
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.fillStyle = color;
    rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && g.fillRect(x, y, 1, 1)));
    return c;
  }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const PICT = {
    ant: ['#.#......##', '#.#....####', '.#...######', '.#..#######', '.#..#######', '.#..#######', '.#..#######', '.#..#######'],
    mail: ['#########', '##.....##', '#.#...#.#', '#..#.#..#', '#...#...#', '#.......#', '#########'],
    bat: ['#########..', '#.##.##.###', '#.##.##.#.#', '#.##.##.#.#', '#.##.##.###', '#.......#..', '#########..'],
  };
  const ICONS = {
    lyric: ['...##...', '...###..', '...#.##.', '...#..#.', '...#....', '.###....', '####....', '.##.....'],
    full:  ['..####..', '.#....#.', '#..##..#', '#.####.#', '#.####.#', '#..##..#', '.#....#.', '..####..'],
    live:  ['.#....#.', '..#..#..', '########', '#......#', '#.####.#', '#.####.#', '#......#', '########'],
    uni:   ['...#....', '..###...', '.#####..', '#######.', '.#####..', '..###...', '...#....', '........'],
    index: ['.#####..', '#.....#.', '#.....#.', '#.....#.', '.#####..', '.....##.', '......##', '.......#'],
    star:  ['...#....', '...#....', '..###...', '#######.', '.#####..', '.##.##..', '.#...#..', '........'],
    list:  ['########', '........', '#.######', '........', '#.######', '........', '#.######', '........'],
    cam:   ['........', '..##....', '########', '#..##..#', '#.#..#.#', '#..##..#', '########', '........'],
    gacha: ['..####..', '.#....#.', '#.#..#.#', '#......#', '########', '#.####.#', '#......#', '.######.'],
    diary: ['.######.', '.#....#.', '.#.##.#.', '.#....#.', '.#.##.#.', '.#....#.', '.######.', '........'],
    orbit: ['...##...', '..####..', '########', '.######.', '########', '..####..', '...##...', '........'],
    me:    ['..###...', '.#####..', '.#####..', '..###...', '........', '.#####..', '#######.', '#######.'],
  };

  /* 鍵盤 12 顆 = 網站 12 個地方 (作品集收在「プロフ」裡); 改選單時兩邊一起看 src/data/site-nav.json */
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  const KANA = { 1: 'あ', 2: 'に', 3: 'さ', 4: 'し', 5: 'な', 6: 'は', 7: 'な', 8: 'や', 9: 'ら', 0: 'わ', '*': '', '#': '' };   // 2 4 7 = に し な
  const APPS = [
    ['lyric', '翻譯', '/translations', '#ff8c69'], ['full', '完整Live', '/live/full/', '#e8c94a'], ['live', 'Live', '/live/', '#ff8c69'],
    ['uni', '歌詞宇宙', '/lyric-universe/', '#f064a0'], ['index', '索引', '/kwic/', '#5ca8ff'], ['star', '星圖', '/star-map/', '#60e0d2'],
    ['list', 'Setlist', '/setlists/', '#e8c94a'], ['cam', '花絮', '/extras/', '#46be6e'], ['gacha', 'ガチャ', '/gacha/', '#e8c94a'],
    ['diary', '日記', '/diary', '#b6c2e0'], ['orbit', '宇宙', '/galaxy/', '#ffb347'], ['me', 'プロフ', '/about', '#c86ef0'],
  ];

  let active = null;   // 鍵盤事件交給最近用過、而且打開著的那一支

  function build(root, { overlay = false, onClose } = {}) {
    root.classList.add('n2');
    root.innerHTML = `
      <div class="n2-shell n2-closed" role="button" tabindex="0" aria-label="打開 N247i">
        <span class="n2-cam"></span><span class="n2-led"></span>
        <div class="n2-sub"><div class="t"></div><div class="m"></div></div>
        <div class="n2-model">N247i</div><div class="n2-hint">點一下打開</div>
      </div>
      <div class="n2-open">
        <div class="n2-shell n2-top"><div class="n2-lcd">
          <div class="n2-pict"></div>
          <div class="n2-view" data-v="standby"></div>
          <div class="n2-view" data-v="menu"><div class="n2-menu"></div></div>
          <div class="n2-view n2-mail" data-v="mail"></div>
          <div class="n2-view n2-call" data-v="call"></div>
          <div class="n2-view n2-dial" data-v="dial"></div>
          <div class="n2-view n2-book" data-v="book"></div>
          <div class="n2-view n2-list" data-v="list"></div>
          <div class="n2-view n2-song" data-v="song"></div>
          <div class="n2-view n2-conn" data-v="conn"></div>
          <div class="n2-ring"><div>✉<b>新着メール 1件</b>にしな<br><br>決定キーで開く</div></div>
          <div class="n2-soft"><span></span><span></span><span></span></div>
        </div></div>
        <div class="n2-hinge"></div>
        <div class="n2-shell n2-bot">
          <div class="n2-dpad"><button type="button" data-k="L" aria-label="左ソフトキー"></button>
            <span class="ring"><button type="button" data-k="C" aria-label="決定"></button></span>
            <button type="button" data-k="R" aria-label="右ソフトキー"></button></div>
          <div class="n2-keys"></div>
          <div class="n2-brand">N247i</div>
        </div>
      </div>`;
    const $ = s => root.querySelector(s);
    const views = Object.fromEntries([...root.querySelectorAll('[data-v]')].map(e => [e.dataset.v, e]));
    const softEls = [...root.querySelectorAll('.n2-soft span')];
    const top = $('.n2-top');
    const phone = { root, isOpen: () => root.classList.contains('is-open'), key: null };

    // 狀態列: 天線 / 未讀 / 電池 (當年待受上方只有這些ピクト, 不會寫電信名稱)
    const pict = $('.n2-pict');
    const pAnt = bitmap(canvas(11, 8), PICT.ant, '#fff'), pMail = bitmap(canvas(9, 7), PICT.mail, '#e8c94a'), pBat = bitmap(canvas(11, 7), PICT.bat, '#fff');
    pMail.className = 'mailp';
    const sp = document.createElement('span'); sp.className = 'sp';
    pict.append(pAnt, pMail, sp, pBat);

    // MENU
    const menu = $('.n2-menu');
    let sel = 0;
    APPS.forEach(([ic, label, href, col], i) => {
      const a = document.createElement('a'); a.href = href;
      const c = bitmap(canvas(8, 8), ICONS[ic], col);
      a.append(c); a.insertAdjacentHTML('beforeend', `<span>${KEYS[i]} ${label}</span>`);
      a.addEventListener('click', e => { e.preventDefault(); if (sel !== i) pick(i); else launch(i); });
      menu.append(a);
    });
    const pick = i => { sel = i; [...menu.children].forEach((a, j) => a.classList.toggle('sel', j === i)); };
    pick(0);

    // 鍵盤
    const keys = $('.n2-keys');
    KEYS.forEach(k => {
      const b = document.createElement('button'); b.type = 'button';
      if ('247'.includes(k)) b.className = 'n247';
      b.innerHTML = `${k}<small>${KANA[k] || '&nbsp;'}</small>`;
      b.addEventListener('click', () => press(k));
      keys.append(b);
    });

    let view = 'standby', ringing = false, number = '', song = null, data = { songs: [], upcoming: [] };
    // 網址上的 ?n2= 要在第一次 show() 之前先讀起來 (show 回待受時會把它清掉)
    const route = !overlay && new URLSearchParams(location.search).get('n2');
    const SOFT = {
      standby: ['メール', 'MENU', '完整Live'],
      menu: overlay ? ['検索', '選択', '閉じる'] : ['戻る', '選択', '完整Live'],
      mail: ['戻る', '', '完整Live'], call: ['', '終話', ''], dial: ['電話帳', '発信', 'クリア'], book: ['戻る', '発信', ''],
      list: ['戻る', '選択', ''], song: ['戻る', '解説', 'PC'], conn: ['', '', ''],
    };
    function show(v, soft) {
      view = v;
      Object.entries(views).forEach(([k, e]) => e.classList.toggle('on', k === v));
      (soft || SOFT[v]).forEach((t, i) => { softEls[i].textContent = t; });
      if (!overlay && (v === 'standby' || v === 'menu')) setRoute(null);
    }

    /* ---------- App: 清單 (着うた的專輯 / 歌, ワンセグ的歌) ---------- */
    let list = null;     // { title, items: [{ label, sub, act }], sel, back }
    function openList(l) { list = { sel: 0, ...l }; renderList(); show('list'); }
    function renderList() {
      views.list.innerHTML = `<div class="hd">${esc(list.title)}</div>` + list.items.map((it, i) =>
        `<div class="it${i === list.sel ? ' sel' : ''}" data-i="${i}"><span class="n">${i < 9 ? i + 1 : ''}</span><span class="l">${esc(it.label)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</div>`).join('');
      views.list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    function listMove(d) { list.sel = (list.sel + d + list.items.length) % list.items.length; renderList(); }
    views.list.addEventListener('click', e => { const it = e.target.closest('.it'); if (!it) return; active = phone; list.sel = +it.dataset.i; renderList(); list.items[list.sel].act(); });

    /* 着うた: 專輯資料夾 → 歌 → 歌詞 / 解説 (資料: /n247i/uta.json, /n247i/uta/<id>.json) */
    let utaP = null;
    const loadUta = () => utaP || (utaP = fetch('/n247i/uta.json').then(r => r.json()));
    function openUta(albumIdx) {
      loadUta().then(u => {
        if (albumIdx == null) {
          openList({ title: '♪ 着うた', back: () => show('menu'),
            items: u.albums.map((a, i) => ({ label: a.album, sub: `${a.year ? a.year + ' · ' : ''}${a.songs.length}曲`, act: () => openUta(i) })) });
          setRoute('uta');
        } else {
          const a = u.albums[albumIdx];
          openList({ title: `♪ ${a.album}`, back: () => openUta(),
            items: a.songs.map(sg => ({ label: sg.title, sub: sg.full ? '完整Live' : '', act: () => openSong(sg.id, () => openUta(albumIdx)) })) });
        }
      });
    }
    let cur = null, songMode = 'lyrics', songBack = null;
    function openSong(id, back) {
      songBack = back || (() => openUta());
      views.song.innerHTML = '<div class="hd">読込中…</div>'; show('song');
      fetch(`/n247i/uta/${id}.json`).then(r => r.json()).then(d => { cur = d; songMode = 'lyrics'; renderSong(); setRoute('uta/' + id); });
    }
    function renderSong() {
      const d = cur;
      views.song.innerHTML = `<div class="hd">♪ ${esc(d.title)}<i>${esc(d.album)}${d.year ? ' · ' + d.year : ''}</i></div>` + (songMode === 'lyrics'
        ? (d.lines.length ? d.lines.map(l => `<div class="ln"><span class="ja">${esc(l.ja)}</span>${l.zh ? `<span class="zh">${esc(l.zh)}</span>` : ''}</div>`).join('') : '<p class="none">（純演奏・歌詞なし）</p>')
        : (d.note.length ? d.note.map(p => `<p>${esc(p)}</p>`).join('') : '<p class="none">（解説はまだありません）</p>'));
      views.song.scrollTop = 0;
      show('song', ['戻る', songMode === 'lyrics' ? '解説' : '歌詞', d.full ? '完整Live' : 'PC']);
    }

    /* ワンセグ: 能完整播的歌 → サイクロイド大螢幕 */
    function openSegList() {
      openList({ title: '📺 ワンセグ ・ 完整 Live', back: () => show('menu'),
        items: data.songs.map(sg => ({ label: sg.title, sub: sg.album, act: () => openSeg(sg.id, sg.title) })) });
    }

    /* 跳出去的頁面: 「接続中…」再走; 大型視覺化 (歌詞宇宙 / 索引 / 星圖) 用 PCサイトビューアー */
    function connect(href, pc) {
      views.conn.innerHTML = `<div>${pc ? 'PCサイトビューアー' : 'iモード'}</div><b>接続中…</b><i><u></u></i>`;
      show('conn');
      setTimeout(() => { location.href = href; }, 520);
    }
    function launch(i) {
      if (i === 0) return openUta();
      if (i === 1) return openSegList();
      connect(APPS[i][2], i >= 3 && i <= 5);
    }

    /* 網址: 手機裡的畫面也有網址 (?n2=uta/<id>), 分享出去對方打開就直接開在那首歌 */
    function setRoute(r) {
      if (overlay) return;
      const u = new URL(location.href);
      if (r) u.searchParams.set('n2', r); else u.searchParams.delete('n2');
      if (u.href !== location.href) history.replaceState(history.state, '', u);
    }
    const daysToLive = () => {
      const today = jstDate(), next = data.upcoming.find(e => e.date >= today);
      return next ? { ev: next, days: Math.round((Date.parse(next.date) - Date.parse(today)) / 864e5) } : null;
    };
    const unread = () => store.get('n247i-mail') !== jstDate();

    /* 待受: 今日の一曲 (每天輪一首能完整播的歌), 歌詞像卡拉 OK 一句一句亮 */
    function buildStandby() {
      const st = views.standby;
      st.innerHTML = `<div class="n2-np-shade"></div><div class="n2-np-date"></div><div class="n2-np-clock"></div><div class="n2-np-msg"></div>
        <div class="n2-np-lyric"><span class="ja"></span><span class="zh"></span></div>
        <div class="n2-np-card"><div class="n2-np-row"></div><div class="n2-np-bar"><i></i></div><div class="n2-np-time"><span class="a">0:00</span><span>今日の一曲</span></div></div>`;
      const bg = canvas(24, 32); bg.className = 'n2-np-bg'; st.prepend(bg);
      const thumb = canvas(16, 16);
      $('.n2-np-row').append(thumb);
      if (!song) return;
      $('.n2-np-row').insertAdjacentHTML('beforeend', `<div class="n2-np-meta"><div class="n2-np-title">♪ ${esc(song.title)}</div><div class="n2-np-artist">にしな・${esc(song.album)}</div></div>`);
      if (song.cover) {
        const im = new Image();
        im.onload = () => { bg.getContext('2d').drawImage(im, 0, 0, 24, 32); thumb.getContext('2d').drawImage(im, 0, 0, 16, 16); };
        im.src = song.cover;
      }
      const ja = $('.n2-np-lyric .ja'), zh = $('.n2-np-lyric .zh'), bar = $('.n2-np-bar i'), a = $('.n2-np-time .a');
      const t0 = performance.now(), PER = 3600, n = song.lines.length;
      (function karaoke(t) {
        if (!root.isConnected) return;
        if (phone.isOpen() && view === 'standby') {
          const dt = Math.max(0, t - t0), k = Math.floor(dt / PER) % n, p = (dt % PER) / PER;
          const chars = [...song.lines[k].ja], cut = Math.ceil(chars.length * Math.min(1, p * 1.4));
          ja.innerHTML = `<i>${esc(chars.slice(0, cut).join(''))}</i>${esc(chars.slice(cut).join(''))}`;
          zh.textContent = song.lines[k].zh;
          const frac = (dt % (n * PER)) / (n * PER); bar.style.width = frac * 100 + '%';
          const s = frac * n * 6; a.textContent = `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
        }
        requestAnimationFrame(karaoke);
      })(t0);
    }
    function tick() {
      const d = new Date(), live = daysToLive();
      $('.n2-sub .t').textContent = hhmm(d);
      const c = $('.n2-np-clock'); if (!c) return;
      c.textContent = hhmm(d); c.classList.toggle('special', is247(d));
      $('.n2-np-date').textContent = `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
      $('.n2-np-msg').textContent = is247(d) ? '— に・し・な の時間 —' : live ? (live.days ? `ライブまであと ${live.days} 日` : '今日はライブ！') : '';
    }
    function refreshUnread() {
      const u = unread();
      $('.n2-led').classList.toggle('on', u && !overlay);
      pMail.classList.toggle('on', u);
      const live = daysToLive();
      $('.n2-sub .m').textContent = [song && `♪ 今日の一曲「${song.title}」`, 'N247i', u && '新着メール 1件', live && live.days && `ライブまであと ${live.days} 日`]
        .filter(Boolean).join(' ◆ ') + ' ◆';
    }

    /* 新着メール: 一天最多一封 */
    function incoming() {
      if (!phone.isOpen() || !unread() || ringing || view !== 'standby') return;
      ringing = true; $('.n2-ring').classList.add('on');
      top.classList.remove('n2-shake'); void top.offsetWidth; top.classList.add('n2-shake');
    }
    function openMail() {
      ringing = false; $('.n2-ring').classList.remove('on');
      store.set('n247i-mail', jstDate()); refreshUnread();
      const live = daysToLive();
      views.mail.innerHTML = `<div class="hd">From: にしな<br>Sub: <span class="deco">★</span>今日の一曲<span class="deco">★</span></div>
        ${song ? `今日は「${esc(song.title)}」を<br>最初から最後まで聴けるよ <span class="deco">♪♪</span><br>` : ''}
        ${live && live.days > 0 ? `${esc(live.ev.date.slice(5).replace('-', '/'))} は ${esc(live.ev.venue)}！<br>あと <b>${live.days}</b> 日 <span class="deco">(*^▽^*)</span><br>` : ''}<br>
        <span class="ft">右鍵：完整 Live ・ 左鍵：戻る</span>`;
      show('mail');
    }

    /* 撥號: 待受直接按數字就開始撥 (跟真的ガラケー一樣), 決定鍵発信; 247 = にしな, 其他號碼是「現在使われておりません」 */
    function renderDial() { views.dial.innerHTML = `<div class="dl">発信番号</div><div class="num">${esc(number) || '&nbsp;'}</div><div class="dh">決定キー：発信</div>`; }
    function typeDigit(k) { if (view !== 'dial') { number = ''; show('dial'); } number = (number + k).slice(0, 16); renderDial(); }
    function clearDigit() { number = number.slice(0, -1); if (number) renderDial(); else show('standby'); }
    function placeCall() {
      if (!number) return;
      const n = number;
      views.call.innerHTML = n === '247' ? '<div>発信中…</div><div class="big">247</div><div class="kana">に し な</div>' : `<div>発信中…</div><div class="big2">${esc(n)}</div>`;
      show('call');
      setTimeout(() => {
        if (view !== 'call') return;
        if (n !== '247') { views.call.innerHTML = `<div class="big2">${esc(n)}</div><div class="ly">おかけになった電話番号は<br>現在使われておりません。</div>`; return; }
        const L = data.songs[Math.floor(Math.random() * data.songs.length)];
        const ln = L && L.lines[Math.floor(Math.random() * L.lines.length)];
        views.call.innerHTML = `<div>通話中 00:24</div><div class="big">247</div><div class="kana">に し な</div>`
          + (ln ? `<div class="ly">「${esc(ln.ja)}」<br><span class="zh2">${esc(ln.zh)}</span><br><span class="zh2">—「${esc(L.title)}」</span></div>` : '');
      }, 1500);
    }
    function openBook() { views.book.innerHTML = '<div class="bh">電話帳</div><div class="be"><span>にしな</span><span>247</span></div>'; show('book'); }

    /* 按鍵 */
    const fullLive = () => { if (song) openSeg(song.id, song.title); };
    function flash(k) { const b = keys.children[KEYS.indexOf(k)]; if (!b) return; b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); }
    function press(k) {
      active = phone;
      if (!phone.isOpen()) return open();
      flash(k);
      if (view === 'menu') pick(KEYS.indexOf(k));
      else if (view === 'list' && /\d/.test(k) && +k >= 1 && +k <= list.items.length) { list.sel = +k - 1; renderList(); list.items[list.sel].act(); }
      else if (view === 'standby' || view === 'dial') typeDigit(k);
    }
    function soft(w) {
      active = phone;
      if (!phone.isOpen()) return open();
      if (ringing) return openMail();
      if (view === 'standby') { if (w === 'L') openMail(); if (w === 'C') show('menu'); if (w === 'R') fullLive(); }
      else if (view === 'list') { if (w === 'L') list.back(); if (w === 'C') list.items[list.sel].act(); }
      else if (view === 'song') {
        if (w === 'L') songBack();
        if (w === 'C') { songMode = songMode === 'lyrics' ? 'note' : 'lyrics'; renderSong(); }
        if (w === 'R') { if (cur.full) openSeg(cur.id, cur.title); else connect(`/translations/${cur.id}/`, true); }
      }
      else if (view === 'conn') {}
      else if (view === 'menu') {
        if (w === 'C') launch(sel);
        if (overlay) { if (w === 'L') { close(); window.__shellCli?.open(); } if (w === 'R') close(); }
        else { if (w === 'L') show('standby'); if (w === 'R') fullLive(); }
      }
      else if (view === 'mail') { if (w === 'L') show('standby'); if (w === 'R') fullLive(); }
      else if (view === 'dial') { if (w === 'L') openBook(); if (w === 'C') placeCall(); if (w === 'R') clearDigit(); }
      else if (view === 'book') { if (w === 'L') show('standby'); if (w === 'C') { number = '247'; placeCall(); } }
      else if (view === 'call') show('standby');
    }
    root.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => soft(b.dataset.k)));
    phone.key = e => {
      const k = e.key;
      if (KEYS.includes(k)) { e.preventDefault(); press(k); }
      else if (k === 'Enter') { e.preventDefault(); soft('C'); }
      else if (k === 'Backspace' && view === 'dial') { e.preventDefault(); clearDigit(); }
      else if (k === 'Escape') {
        e.preventDefault();
        if (view === 'list') list.back(); else if (view === 'song') songBack();
        else if (view === (overlay ? 'menu' : 'standby')) close(); else show(overlay ? 'menu' : 'standby');
      }
      else if ((view === 'list') && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); listMove(k === 'ArrowDown' ? 1 : -1); }
      else if (view === 'song' && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); views.song.scrollBy(0, k === 'ArrowDown' ? 48 : -48); }
      else if (view === 'menu' && /^Arrow/.test(k)) {
        e.preventDefault();
        pick((sel + { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[k] + APPS.length) % APPS.length);
      }
    };

    function open() {
      root.classList.add('is-open'); active = phone;
      if (root.contains(document.activeElement)) document.activeElement.blur();   // 焦點留在藏起來的外殼上, 下一個 Enter 會又「打開」一次
      show(overlay ? 'menu' : 'standby');
      if (!overlay) setTimeout(incoming, 2500);
    }
    function close() {
      ringing = false; $('.n2-ring').classList.remove('on');
      if (overlay) { onClose && onClose(); return; }
      root.classList.remove('is-open'); refreshUnread();
      if (active === phone) active = null;
    }
    const closedEl = $('.n2-closed');
    closedEl.addEventListener('click', open);
    closedEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    root.addEventListener('pointerdown', () => { active = phone; });

    loadData().then(d => {
      data = d; song = d.songs.length ? d.songs[jstDay() % d.songs.length] : null;
      buildStandby(); tick(); refreshUnread();
      const r = route;
      if (r) {
        root.classList.add('is-open'); active = phone;
        const [app, id] = r.split('/');
        if (app === 'uta' && id) openSong(id); else if (app === 'uta') openUta();
        else if (app === 'seg' && id) { show('standby'); openSeg(id, (d.songs.find(x => x.id === id) || {}).title || ''); }
      }
    });
    const timer = setInterval(() => { if (!root.isConnected) return clearInterval(timer); tick(); }, 10000);
    show(overlay ? 'menu' : 'standby');
    phone.open = open;
    return phone;
  }

  /* ワンセグ: 螢幕轉 90 度變成橫的大螢幕 (サイクロイド), 裡面是完整 Live 播放器的精簡版 (/live/full/<id>/?embed=1)
     手機直拿的時候不轉, 直接全螢幕 */
  let tv = null;
  function openSeg(id, title) {
    closeSeg();
    tv = document.createElement('div'); tv.className = 'n2-tv';
    tv.innerHTML = `<div class="n2-tv-set"><div class="n2-tv-bar"><span>📺 ワンセグ ・ 完整 Live「${esc(title)}」</span>
        <button type="button" class="n2-tv-x">◀ 戻る</button></div>
      <div class="n2-tv-screen"><iframe title="完整 Live「${esc(title)}」" src="/live/full/${encodeURIComponent(id)}/?embed=1" allow="autoplay; encrypted-media"></iframe></div></div>`;
    document.body.append(tv);
    window.__scrollLockCount = (window.__scrollLockCount || 0) + 1;
    const fr = tv.querySelector('iframe');
    fr.addEventListener('load', () => fr.classList.add('on'));
    tv.querySelector('.n2-tv-x').addEventListener('click', closeSeg);
    tv.addEventListener('click', e => { if (e.target === tv) closeSeg(); });
    requestAnimationFrame(() => tv && tv.classList.add('on'));
    const u = new URL(location.href);
    if (!document.querySelector('.n2-overlay')) { u.searchParams.set('n2', 'seg/' + id); history.replaceState(history.state, '', u); }
  }
  function closeSeg() {
    if (!tv) return;
    tv.remove(); tv = null;
    window.__scrollLockCount = Math.max(0, (window.__scrollLockCount || 1) - 1);
    const u = new URL(location.href);
    if (u.searchParams.get('n2')?.startsWith('seg/')) { u.searchParams.delete('n2'); history.replaceState(history.state, '', u); }
  }

  addEventListener('keydown', e => {
    if (tv && e.key === 'Escape') { e.preventDefault(); closeSeg(); return; }
    if (tv) return;
    if (!active || !active.isOpen() || !active.root.isConnected) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    // 焦點在頁面其他地方 (例如某個連結) 時不搶按鍵, 不然 Enter 會被吃掉
    if (t && t !== document.body && !active.root.contains(t)) return;
    active.key(e);
  });

  window.N247i = {
    mount(el) { return build(el); },
    // 手機上的導航: 疊一層, 直接開在 MENU; 關掉時把畫面還回去
    overlay() {
      const wrap = document.createElement('div'); wrap.className = 'n2-overlay';
      const host = document.createElement('div'); wrap.append(host);
      document.body.append(wrap);
      window.__scrollLockCount = (window.__scrollLockCount || 0) + 1;
      const prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      let close = () => {
        wrap.remove();
        window.__scrollLockCount = Math.max(0, (window.__scrollLockCount || 1) - 1);
        document.documentElement.style.overflow = prevOverflow;
        if (active === phone) active = null;
      };
      const phone = build(host, { overlay: true, onClose: () => close() });
      wrap.addEventListener('click', e => { if (e.target === wrap) close(); });   // close 下面會換成連 resize 一起拆的版本
      phone.open();
      // 手機螢幕放不下整支 (掀開約 640px 高) 就整支縮小, 鍵盤不會被切掉
      const fit = () => { host.style.zoom = ''; const k = Math.min(1, (innerHeight - 24) / host.offsetHeight, (innerWidth - 24) / host.offsetWidth); if (k < 1) host.style.zoom = k.toFixed(3); };
      fit(); addEventListener('resize', fit);
      const off = close; close = () => { removeEventListener('resize', fit); off(); };
      return phone;
    },
  };
})();
