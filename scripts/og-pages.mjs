/**
 * og-pages.mjs — 每首歌 + 靜態頁的 OG 分享圖 (1200×630 像素風, 畫法跟 og-default 同一套, 見 og-lib.mjs)
 *
 * 用法 (repo root):  node scripts/og-pages.mjs [歌曲 id …]
 *   → public/og/song/<id>.png   左上封面馬賽克 + 歌名 + 專輯 / 年份 + 第一句歌詞 (日 / 中)
 *   → public/og/<page>.png      歌詞宇宙 / 星圖 / ガチャ / 索引, 右側畫該頁的像素行星
 * 新增歌曲、改歌名或第一句歌詞後重跑; 不帶參數就全部重畫。
 * 歌曲頁 (translations/[id].astro) 有圖就用, 沒有就退回封面。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, W, H, P, baseBuffer, t, compose, measure, fit, drawOrb } from './og-lib.mjs';

const nav = JSON.parse(readFileSync(path.join(ROOT, 'src/data/site-nav.json'), 'utf-8'));
const outDir = path.join(ROOT, 'public/og');
mkdirSync(path.join(outDir, 'song'), { recursive: true });
const save = (rel, buf) => {
  writeFileSync(path.join(outDir, rel), buf);
  console.log(`✓ public/og/${rel} (${(buf.length / 1024).toFixed(0)}KB)`);
};
const seedOf = s => [...s].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 20210625);

// ---------- 歌曲 ----------
const fm = (src, key) => src.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1];
const plain = s => s.replace(/<rt>.*?<\/rt>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();

async function song(id) {
  const src = readFileSync(path.join(ROOT, 'src/content/translations', id + '.md'), 'utf-8');
  const title = fm(src, 'title'), artist = fm(src, 'artist') ?? '', album = fm(src, 'album');
  const year = fm(src, 'albumYear'), coverPath = fm(src, 'coverImage');
  const cover = coverPath && existsSync(path.join(ROOT, 'public', coverPath)) ? coverPath : null;
  const instrumental = fm(src, 'instrumental') === 'true';
  const line = src.match(/<div class="lyrics-line">([\s\S]*?<\/div>)\s*<\/div>/);
  const ja = line && plain(line[1].match(/<div class="ja">([\s\S]*?)<\/div>/)?.[1] ?? '');
  const zh = line && plain(line[1].match(/<div class="zh">([\s\S]*?)<\/div>/)?.[1] ?? '');

  const { buf, px, rect } = baseBuffer(seedOf(id));
  // 封面: 縮成 32×32 再每格放大 2 倍 = 64×64 的馬賽克 (跟歌曲頁 hero 背景同一種顆粒)
  if (cover) {
    const raw = await sharp(path.join(ROOT, 'public', cover)).resize(32, 32, { fit: 'cover' }).removeAlpha().raw().toBuffer();
    rect(13, 13, 66, 66, P.deep);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 3;
      rect(14 + x * 2, 14 + y * 2, 2, 2, [raw[i], raw[i + 1], raw[i + 2]]);
    }
  }
  const x0 = cover ? 88 : 14, tw = 226 - x0;
  // 文字底下的星星清掉, 不然貼在字旁邊像多出來的標點
  rect(x0 - 2, 10, tw + 4, 66, P.bg);
  rect(12, 84, 216, 32, P.bg);
  const site = 'derekni.com', siteW = await measure(site, 12);
  // 歌名: 24px 放得下就用 24px, 否則 12px 依空白斷成最多兩行
  let titleTexts;
  if (await measure(title, 24) <= tw) titleTexts = [t(title, x0, 28, 24, 'JP12', P.gold)];
  else {
    const words = title.split(' ');
    let n = words.length;
    while (n > 1 && await measure(words.slice(0, n).join(' '), 12) > tw) n--;
    const rows = [words.slice(0, n).join(' '), words.slice(n).join(' ')].filter(Boolean);
    titleTexts = await Promise.all(rows.map(async (r, i) =>
      t(await fit(r, 12, 'JP12', tw), x0, rows.length > 1 ? 28 + i * 14 : 34, 12, 'JP12', P.gold)));
  }
  const texts = [
    t(await fit(artist, 12, 'JP12', tw - siteW - 8), x0, 12, 12, 'JP12', P.dim),
    t(site, 226 - siteW, 12, 12, 'JP12', P.dim),
    ...titleTexts,
    t(await fit([album, year].filter(Boolean).join(' · '), 12, 'JP12', tw), x0, 60, 12, 'JP12', P.light),
  ];
  if (ja && !instrumental) {
    texts.push(t(await fit(ja, 12, 'JP12', 212), 14, 86, 12, 'JP12', P.text));
    if (zh) texts.push(t(await fit(zh, 12, 'TC12', 212), 14, 102, 12, 'TC12', P.dim));
  } else {
    texts.push(t(instrumental ? 'Instrumental' : '翻譯中', 14, 86, 12, 'TC12', P.text));
    texts.push(t('日文歌翻譯', 14, 102, 12, 'TC12', P.dim));
  }
  save(`song/${id}.png`, await compose(buf, texts));
}

// ---------- 靜態頁 ----------
const PAGES = {
  'lyric-universe': { planet: 'venus', title: '歌詞宇宙', lines: [['用資料回答：', 'TC12'], ['她的歌詞世界是由什麼構成的。', 'TC12']], tag: 'IMAGERY・COLOR・WORDS' },
  'star-map': { planet: 'uranus', title: '歌詞星圖', lines: [['每一句歌詞都是一顆星', 'TC12'], ['意思相近的句子聚在一起', 'TC12']], tag: 'UMAP・LYRICS' },
  'gacha': { planet: 'jupiter', title: '歌詞卡ガチャ', lines: [['點扭蛋機', 'TC12'], ['抽一張獨一無二的歌詞卡', 'TC12']], tag: 'GACHA β' },
  'kwic': { planet: 'orbit', title: '歌詞索引', lines: [['Key Word In Context', 'JP12'], ['以原形檢索，活用形一網打盡', 'TC12']], tag: 'KWIC' },
};
async function page(name) {
  const cfg = PAGES[name], planet = nav.planets[cfg.planet];
  const { buf, px, rect } = baseBuffer(seedOf(name), planet.palette[1]);
  rect(12, 10, 164, 106, P.bg);
  drawOrb(px, 178, 8, planet);
  save(`${name}.png`, await compose(buf, [
    t('にしな', 14, 12, 12, 'JP12', P.dim),
    t(cfg.title, 14, 30, 24, 'JP12', P.gold),
    ...cfg.lines.map(([s, fam], i) => t(s, 14, 62 + i * 16, 12, fam, i ? P.dim : P.text)),
    t(cfg.tag + ' — derekni.com', 14, 102, 12, 'JP12', P.light),
  ]));
}

const only = process.argv.slice(2);
const ids = only.length ? only : readdirSync(path.join(ROOT, 'src/content/translations'))
  .filter(f => /\.mdx?$/.test(f)).map(f => f.replace(/\.mdx?$/, ''));
for (const id of ids) await song(id);
if (!only.length) for (const name of Object.keys(PAGES)) await page(name);
