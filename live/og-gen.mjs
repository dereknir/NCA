/**
 * og-gen.mjs — 三個 live 頁的 OG 分享圖(像素風,1200×630 = 基底 240×126 ×5)
 * 用法 (在 live/ 底下): node og-gen.mjs  → public/og/{timeline,concerts,footprint}.png
 * 星空底 / 字型 / 合成共用 scripts/og-lib.mjs。
 * 資料更新後與 inject.py 一起重跑。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { P, baseBuffer, t, compose } from '../scripts/og-lib.mjs';

const CAT = { LIVE: [58, 169, 129], RELEASE: [226, 96, 58], TIEUP: [138, 99, 201],
              COLLAB: [225, 81, 142], GOODS: [239, 159, 39], OTHER: [124, 141, 181] };

const events = JSON.parse(readFileSync('data/nishina_live_events.json', 'utf-8'));
const tours = JSON.parse(readFileSync('data/tour_stops.json', 'utf-8'));
const news = JSON.parse(readFileSync('data/nishina_news_classified.json', 'utf-8'));
const japan = JSON.parse(readFileSync('data/japan_paths.json', 'utf-8'));
// GEO 規則直接取自 footprint 模板,口徑保證一致
const tpl = readFileSync('footprint.template.html', 'utf-8');
const GEO = [...tpl.match(/const GEO = \[([\s\S]*?)\];/)[1]
  .matchAll(/\['([^']+)','([^']+)'\]/g)].map(m => [m[1], m[2]]);

const litPrefs = new Set(tours.tours.flatMap(t => t.stops.map(s => s.pref)));
for (const ev of events.appearance) {
  const src = ev.name + ' ' + (ev.venue || '');
  const hit = GEO.find(([k]) => src.includes(k));
  if (hit) litPrefs.add(hit[1]);
}
const nStops = tours.tours.reduce((n, t) => n + t.stops.length, 0);

async function render(name, drawExtra, texts) {
  const { buf, px, rect } = baseBuffer(name.length * 7919 + 20210625);
  drawExtra && drawExtra(px, rect);
  const out = await compose(buf, texts, { palette: false });
  writeFileSync(`../public/og/${name}.png`, out);
  console.log(`✓ public/og/${name}.png(${(out.length / 1024).toFixed(0)}KB)`);
}

mkdirSync('../public/og', { recursive: true });

// ---- timeline ----
const catCounts = {};
for (const i of news) catCounts[i.class] = (catCounts[i.class] || 0) + 1;
await render('timeline',
  (px, rect) => {
    let x = 14;
    for (const [k, c] of Object.entries(CAT)) {
      rect(x, 96, 5, 5, c);
      x += 34;
    }
  },
  [
    t('にしな', 12, 10, 12, 'JP12', P.dim),
    t('年表', 14, 30, 24, 'JP12', P.gold),
    t('2021-2026・NEWS 119件', 14, 62, 12, 'JP12', P.text),
    t('公演・発行・媒體・合作の全記録', 14, 78, 12, 'TC12', P.dim),
    ...Object.entries(CAT).map(([k], i) =>
      t(String(catCounts[k] || 0), 22 + i * 34, 92, 12, 'JP12', P.dim)),
  ]);

// ---- concerts ----
await render('concerts', null, [
  t('にしな', 12, 10, 12, 'JP12', P.dim),
  t('公演史', 14, 30, 24, 'JP12', P.gold),
  t('10 TOURS・' + nStops + ' STOPS', 14, 62, 12, 'JP12', P.text),
  t('hatsu(2021) → 日々散漫(2026)', 14, 80, 12, 'JP12', P.dim),
  t('SETLIST・参戦記録', 14, 98, 12, 'TC12', P.dim),
]);

// ---- footprint(右側迷你日本) ----
await render('footprint',
  (px, rect) => {
    const sc = 0.115, ox = 148, oy = 8;
    for (const [name, pp] of Object.entries(japan.prefs)) {
      const x = ox + Math.round(pp.cx * sc), y = oy + Math.round(pp.cy * sc);
      if (litPrefs.has(name)) { rect(x - 1, y - 1, 3, 3, P.gold); px(x, y - 2, P.light); }
      else px(x, y, P.deep);
    }
  },
  [
    t('にしな', 12, 10, 12, 'JP12', P.dim),
    t('出演足跡', 14, 30, 24, 'JP12', P.gold),
    t('67場・' + nStops + '站', 14, 62, 12, 'TC12', P.text),
    t(litPrefs.size + ' 都道府県', 14, 80, 12, 'JP12', P.light),
    t('2021 → 2026', 14, 98, 12, 'JP12', P.dim),
  ]);
