/**
 * gacha/machine.js — 扭蛋機 sprite(程序化繪製,純 JS 無 DOM)
 * 幀 = 參數:knob(旋鈕角度 0/1/2)、bob(蛋浮動相位 0/1)、capsuleOut(取物口的蛋)
 * 尺寸:機身 56×86;舞台建議 120×110 再 ×4 顯示。
 */
export const MACHINE_W = 56, MACHINE_H = 86;

export const MPAL = {
  body: [61, 99, 200], bodyHi: [96, 132, 226], bodyDark: [34, 56, 120],
  glass: [188, 202, 236], glassIn: [22, 32, 58],
  gold: [232, 201, 74], goldDark: [160, 134, 40],
  dark: [12, 18, 32], white: [236, 240, 250],
  capsules: [[225, 81, 142], [58, 169, 129], [239, 159, 39], [91, 110, 225], [138, 99, 201]],
};

const fillCircle = (put, cx, cy, r, c) => {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) put(cx + x, cy + y, c);
};
const ringCircle = (put, cx, cy, r, c) => {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = x * x + y * y;
    if (d <= r * r && d > (r - 1.6) * (r - 1.6)) put(cx + x, cy + y, c);
  }
};
const rect = (put, x, y, w, h, c) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c);
};

/** 兩截式扭蛋(上色下白) */
export function drawCapsule(put, cx, cy, color, r = 5, crack = 0) {
  fillCircle(put, cx, cy, r, MPAL.white);
  for (let y = -r; y <= 0; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) put(cx + x, cy + y, color);
  ringCircle(put, cx, cy, r, MPAL.bodyDark);
  put(cx - 2, cy - 2, MPAL.white);                      // 高光
  if (crack >= 1) {                                      // 裂縫
    for (let i = -r + 1; i <= r - 1; i++) put(cx + i, cy + ((i % 2) ? 0 : -1), MPAL.dark);
  }
  if (crack >= 2) {                                      // 裂開:上蓋掀起
    for (let i = -r + 1; i <= r - 1; i++) put(cx + i, cy - 1 + (i % 3 === 0 ? -1 : 0), MPAL.dark);
  }
}

/**
 * 畫整台機器到 put(x,y,color)
 * opts: { knob:0|1|2, bob:0|1, hatchCapsule:null|colorIndex }
 */
export function drawMachine(put, ox, oy, opts = {}) {
  const { knob = 0, bob = 0, hatchCapsule = null } = opts;
  const P = (x, y, c) => put(ox + x, oy + y, c);

  // 圓頂玻璃艙
  fillCircle(P, 28, 24, 22, MPAL.glassIn);
  ringCircle(P, 28, 24, 22, MPAL.glass);
  // 艙內扭蛋(bob 相位讓奇數顆上下 1px)
  const pos = [[18, 22], [34, 17], [26, 32], [41, 28], [13, 31]];
  pos.forEach(([x, y], i) => {
    const dy = (i % 2 === bob % 2) ? -1 : 0;
    drawCapsule(P, x, y + dy, MPAL.capsules[i % 5], 5, 0);
  });
  // 玻璃高光弧
  for (let i = 0; i < 8; i++) P(15 + i, 10 - Math.floor(i / 3), MPAL.white);

  // 頸圈與機身
  rect(P, 4, 45, 48, 4, MPAL.bodyDark);
  rect(P, 6, 49, 44, 30, MPAL.body);
  rect(P, 6, 49, 3, 30, MPAL.bodyHi);                   // 左受光
  rect(P, 47, 49, 3, 30, MPAL.bodyDark);                // 右陰影
  // 投幣縫
  rect(P, 40, 52, 2, 6, MPAL.dark);

  // 旋鈕(金)+ 轉柄三角度
  fillCircle(P, 20, 60, 7, MPAL.gold);
  ringCircle(P, 20, 60, 7, MPAL.goldDark);
  if (knob === 0) rect(P, 19, 55, 2, 10, MPAL.goldDark);
  else if (knob === 1) { for (let i = -4; i <= 4; i++) P(20 + i, 60 + i, MPAL.goldDark), P(21 + i, 60 + i, MPAL.goldDark); }
  else rect(P, 15, 59, 10, 2, MPAL.goldDark);

  // 取物口
  rect(P, 30, 64, 18, 12, MPAL.dark);
  rect(P, 31, 65, 16, 10, MPAL.glassIn);
  if (hatchCapsule != null) drawCapsule(P, 39, 71, MPAL.capsules[hatchCapsule % 5], 5, 0);

  // 底座與腳
  rect(P, 2, 79, 52, 5, MPAL.bodyDark);
  rect(P, 5, 84, 8, 2, MPAL.dark);
  rect(P, 43, 84, 8, 2, MPAL.dark);
}
