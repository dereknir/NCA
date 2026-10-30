/**
 * og-default.mjs — 全站預設 OG 分享圖 (像素風, 1200×630 = 基底 240×126 ×5)
 *
 * 用法 (repo root):  node scripts/og-default.mjs   → public/og/default.png
 * 風格與 live/og-gen.mjs 的三張同一套 (星空底 + accent 框 + fusion-pixel 12px 字)。
 * 共用畫法 (星空底 / 字型 / 合成) 在 og-lib.mjs。
 * src/config.ts 的 defaultOGImage 指向這張; 沒有自訂封面的頁面 (首頁/日記/列表頁…) 都用它。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, W, H, SCALE, P, baseBuffer, t, h, compose } from './og-lib.mjs';

// 右側一顆小行星 (地球色系, 呼應 /translations 的「地球」hero)
function drawPlanet(px, rect) {
  const cx = 202, cy = 36, r = 18;       // 右上角: 下面三行字會一路寫到右緣
  let s = 20260625;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d2 = x * x + y * y;
    if (d2 > r * r) continue;
    const shade = (x + r) / (2 * r);                 // 左暗右亮
    const land = rnd() < 0.35;
    const c = land ? [58 + 40 * shade, 140 + 50 * shade, 90 + 30 * shade]
                   : [36 + 30 * shade, 80 + 60 * shade, 190 + 50 * shade];
    px(cx + x, cy + y, c.map(v => v | 0));
  }
  // 外緣一圈 accent 光暈
  for (let a = 0; a < 360; a += 3) {
    const x = cx + Math.round((r + 2) * Math.cos(a * Math.PI / 180));
    const y = cy + Math.round((r + 2) * Math.sin(a * Math.PI / 180));
    px(x, y, P.deep);
  }
}

const { buf, px, rect } = baseBuffer(20210625);
drawPlanet(px, rect);
const out = await compose(buf, [
    t("DEREK'S SITE", 14, 12, 12, 'JP12', P.dim),
    t('にしな', 14, 30, 24, 'JP12', P.gold),
    t('歌詞翻譯・歌詞宇宙・Live 記錄', 14, 62, 12, 'TC12', P.text),
    t('LYRICS・SETLISTS・SHORTS・GACHA', 14, 80, 12, 'JP12', P.light),
  ]);
const outDir = path.join(ROOT, 'public/og');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'default.png'), out);
console.log(`✓ public/og/default.png (${(out.length / 1024).toFixed(0)}KB, ${W * SCALE}×${H * SCALE})`);
