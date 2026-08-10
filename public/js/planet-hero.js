/* planet-hero.js — 行星頁頂著陸場景(にしなの宇宙)
   用法:PlanetHero.mount(document.getElementById('hero'), CONFIG)
   CONFIG = { nameJa, title, sub, glType, seed, palette(6色RGB陣列), pageBg }
   零依賴;reduced-motion 靜態呈現;滾出視窗自動暫停。 */
const PlanetHero = (() => {
  const rng = seed => () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const hash = (a, b) => {
    let h = (a * 374761393 + b * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const SHIP_MAP = ['..W..', '.WLW.', '.WLW.', 'WLLLW', 'WWWWW', '.F.F.'];
  const SHIP_COL = { W: [205, 214, 238], L: [61, 99, 255], F: [232, 201, 74] };

  function mount(container, cfg) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pal = cfg.palette;
    const rgb = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
    const cv = document.createElement('canvas');
    cv.className = 'ph-canvas';
    container.prepend(cv);
    const g = cv.getContext('2d');
    let W = 0, H = 0, scrollOff = 0, running = true;

    const RSTEP = 14;
    const rough = cfg.glType === 'ice' ? 34 : cfg.glType === 'wet' ? 14 : 26;
    let ridgeF = [], ridgeM = [];
    const mkRidge = (sd, amp) => {
      const r2 = rng(sd);
      const pts = [];
      let y = 0;
      for (let x = 0; x <= W + RSTEP * 2; x += RSTEP) {
        y += (r2() - .5) * amp;
        y = Math.max(-amp * 2.2, Math.min(amp * 1.2, y));
        pts.push(y);
      }
      return pts;
    };
    const stars = [];
    {
      const r = rng((cfg.seed * 977) | 0);
      for (let i = 0; i < 70; i++)
        stars.push({ x: r(), y: r() * .55, tw: r() * 6.283,
                     c: r() < .6 ? '#8b97b8' : r() < .9 ? '#cdd6ee' : '#e8c94a' });
    }
    function layout() {
      W = container.clientWidth;
      H = container.clientHeight;
      cv.width = W; cv.height = H;
      ridgeF = mkRidge((cfg.seed * 131) | 0, rough);
      ridgeM = mkRidge((cfg.seed * 173) | 0, rough * 1.3);
    }
    function draw(t) {
      // 天空
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, rgb(pal[3]));
      sky.addColorStop(.55, rgb(pal[1]));
      sky.addColorStop(1, rgb(pal[0]));
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      // 星
      for (const st of stars) {
        const a = reduced ? .6 : .35 + .5 * Math.sin(t * .0012 + st.tw);
        g.globalAlpha = Math.max(0, a) * .8;
        g.fillStyle = st.c;
        g.fillRect((st.x * W) | 0, (st.y * H * .8) | 0, 1, 1);
      }
      g.globalAlpha = 1;
      // 視差山稜(滾動時分層退場)
      const p1 = scrollOff * .10, p2 = scrollOff * .16, p3 = scrollOff * .24;
      const drawRidge = (pts, base, col) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(0, base + pts[0]);
        pts.forEach((y, i) => g.lineTo(i * RSTEP, base + y));
        g.lineTo(W + RSTEP, H + 40);
        g.lineTo(0, H + 40);
        g.closePath();
        g.fill();
      };
      drawRidge(ridgeF, H * .68 + p1, rgb(pal[3]));
      drawRidge(ridgeM, H * .74 + p2, rgb(pal[2]));
      const gy = H * .86 + p3;
      g.fillStyle = rgb(pal[1]);
      g.fillRect(0, gy, W, H - gy + 40);
      g.fillStyle = rgba(pal[0], .5);
      for (let x = 0; x < W; x += 6)
        if (hash(x, 7) > .6) g.fillRect(x, gy - 2, 3, 2);
      // 停泊的船 + 信標
      const S = Math.max(4, Math.min(6, (W / 180) | 0));
      const sx = W * .5, sy = gy - 6 * S - 4 + p3;
      SHIP_MAP.forEach((row, j) => [...row].forEach((ch, i2) => {
        const c = SHIP_COL[ch];
        if (!c || ch === 'F') return;
        g.fillStyle = rgb(c);
        g.fillRect(sx + (i2 - 2.5) * S, sy + (j - 3) * S, S, S);
      }));
      g.fillStyle = '#cdd6ee';
      g.fillRect(sx - 3 * S, sy + 3 * S, S, S + 3);
      g.fillRect(sx + 2 * S, sy + 3 * S, S, S + 3);
      if (reduced || ((t / 480) | 0) % 2) {
        g.fillStyle = '#d65555';
        g.fillRect(sx - S / 2, sy - 3 * S - 5, S * .8, S * .8);
      }
      // 環境粒子:風塵 / 飄雪
      if (!reduced) {
        const snow = cfg.glType === 'ice';
        for (let i = 0; i < 12; i++) {
          const wx2 = ((t * (snow ? .02 : .06) * (1 + i * .13) + i * 137) % (W + 40)) - 20;
          const wy2 = snow
            ? ((t * .03 * (1 + i * .07) + i * 91) % H)
            : gy - 10 - (i % 5) * 12 + Math.sin(t * .001 + i) * 4;
          g.fillStyle = rgba(pal[snow ? 5 : 0], snow ? .7 : .3);
          g.fillRect(wx2 | 0, (wy2 + (snow ? 0 : p3)) | 0, 2, snow ? 2 : 1);
        }
      }
      // 底部縫合:淡入頁面底色
      const fade = g.createLinearGradient(0, H * .8, 0, H);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, cfg.pageBg || '#0a0a15');
      g.fillStyle = fade;
      g.fillRect(0, H * .8, W, H * .2);
    }
    let visible = true;
    if ('IntersectionObserver' in window)
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(container);
    function frame(t) {
      if (!running) return;
      if (visible) {
        scrollOff = Math.min(window.scrollY || 0, H);
        draw(t);
      }
      if (reduced) return;   // 靜態一幀
      requestAnimationFrame(frame);
    }
    layout();
    addEventListener('resize', layout);
    requestAnimationFrame(frame);
    return { destroy() { running = false; cv.remove(); } };
  }
  return { mount };
})();
if (typeof module !== 'undefined') module.exports = PlanetHero;
