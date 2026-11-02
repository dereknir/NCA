/* 首頁 B / C 原型共用: 星空背景 + 把 N247i 放大到填滿舞台 (掀開約 640px 高, 用掀開的高度算, 掀開時版面不會跳) */
(function () {
  const stage = document.querySelector('[data-stage]'), host = document.querySelector('[data-n247i]');
  const cv = stage.querySelector('canvas'), g = cv.getContext('2d');
  let s = 11; const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  let stars = [];
  function size() {
    cv.width = Math.ceil(stage.clientWidth / 4); cv.height = Math.ceil(stage.clientHeight / 4);
    stars = Array.from({ length: Math.round(cv.width * cv.height / 90) }, () => [rnd() * cv.width | 0, rnd() * cv.height | 0, rnd() * 6.28, rnd() < .12]);
  }
  (function draw(t) {
    g.clearRect(0, 0, cv.width, cv.height);
    for (const [x, y, p, gold] of stars) {
      const a = .3 + .7 * Math.abs(Math.sin(t / 1100 + p));
      g.fillStyle = gold ? `rgba(232,201,74,${a})` : `rgba(205,214,238,${a})`; g.fillRect(x, y, 1, 1);
    }
    requestAnimationFrame(draw);
  })(0);
  const OPEN_H = 648, W = 268;
  function fit() {
    const room = stage.querySelector('.room');
    const availH = room.clientHeight - 24, availW = room.clientWidth - 32;
    let k = Math.min(availH / OPEN_H, availW / W);
    k = k >= 2 ? 2 : k >= 1 ? Math.floor(k * 4) / 4 : Math.floor(k * 20) / 20;   // 盡量用好看的倍率, 像素才不會糊
    host.style.zoom = k;
    host.parentElement.style.minHeight = OPEN_H * k + 'px';
  }
  size(); fit();
  addEventListener('resize', () => { size(); fit(); });
  window.N247i && N247i.mount(host);
})();
