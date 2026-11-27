// 指定頁面自己的粉圓小檔 (N49): build 完照「這頁實際印出來的字」從共用切片裡挑出來另外存一份。
//
// 年度回顧一頁會抓 12 片粉圓 (~533KB), 但每片其實只用到幾個字。歌詞頁的做法 (N17) 是 build_pixel_fonts.py
// 從粉圓原檔切一個每首歌的檔, 可是年度回顧的內容每天跟著資料排程變 (新場次、地名), 那條排程不會重切字型。
// 所以這裡改在 build 的時候做, 不用 workflow 也不用原檔 (fonts_src/ 不在 git 裡):
//   1. 讀 dist 裡這頁的 HTML, 抓出畫面上的字
//   2. 照 site-shell.css 的 unicode-range 找出每個字在哪一片; 第 0 片全站共用 (多半已經快取), 不動
//   3. 其他片各自用 subset-font 切成只剩這頁的字 → dist/fonts/openhuninn/page/<hash>.woff2
//   4. 在 </head> 前面宣告 (同一個 'openhuninn', 在 site-shell.css 後面 → 這些字先用小檔)
// 沒收到的字 (例如 JS 之後才塞進來的) 照舊從共用切片補, 不會掉到後備字型。
// 一片切一個檔而不是合成一個: harfbuzz 只能切不能合併, 每個小檔 1~3KB, 多幾個請求換掉 ~380KB。
// 檔名是內容的 hash, 資料一變字就跟著變, 快取不會吃到舊檔。dev server 不經過這裡 → 照舊用共用切片。
// 這只是省流量: 讀不到 CSS、切字失敗都只 warn, 那頁留著共用切片照樣能看, 不擋整個 build / 部署。
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import subsetFont from 'subset-font';

const CSS = 'public/css/site-shell.css';
const FACE = /@font-face\s*\{[^}]*font-family:\s*'openhuninn'[^}]*url\('(\/fonts\/openhuninn\/oh-\d+\.woff2)'\)[^}]*unicode-range:\s*([^;]+);[^}]*\}/g;

/** "U+21-7E, U+A9" → Set<code point> */
function parseRange(/** @type {string} */ s) {
  const out = new Set();
  for (const part of s.split(',')) {
    const m = part.trim().match(/^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i);
    if (!m) continue;
    const a = parseInt(m[1], 16), b = m[2] ? parseInt(m[2], 16) : a;
    for (let c = a; c <= b; c++) out.add(c);
  }
  return out;
}

/** @param {number[]} cps */
function toRange(cps) {
  const s = [...new Set(cps)].sort((a, b) => a - b), out = [];
  const hex = (/** @type {number} */ n) => n.toString(16).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `U+${hex(s[i])}` : `U+${hex(s[i])}-${hex(s[j])}`);
    i = j;
  }
  return out.join(', ');
}

/** 畫面上看得到的字: 標籤之間的文字 + CSS 的 content: '…' (script 內容、屬性不算) */
function pageText(/** @type {string} */ html) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('');
  const content = [...css.matchAll(/content:\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => m[1] ?? m[2]).join('');
  const body = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e]);
  return body + content;
}

/** @param {{ pages: string[] }} opts pages = dist 底下的資料夾 (例 'year'), 底下每個 index.html 都處理 */
export default function pageFonts({ pages }) {
  return {
    name: 'page-fonts',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        let css;
        try { css = await readFile(CSS, 'utf-8'); } catch (e) { logger.warn(`讀不到 ${CSS}, 跳過 (${e})`); return; }
        const slices = [...css.matchAll(FACE)].map(m => ({ url: m[1], cps: parseRange(m[2]) }));
        if (!slices.length) { logger.warn(`${CSS} 裡找不到粉圓切片, 跳過`); return; }
        const head = slices.find(s => s.url.endsWith('/oh-00.woff2'));
        const outDir = join(root, 'fonts', 'openhuninn', 'page');
        await mkdir(outDir, { recursive: true });
        /** @type {Map<string, Buffer>} */
        const srcCache = new Map();

        for (const sub of pages) {
          let files = [];
          try {
            files = (await readdir(join(root, sub), { recursive: true }))
              .filter(f => f === 'index.html' || f.endsWith('/index.html')).map(f => join(root, sub, f));
          } catch { continue; }
          for (const file of files) try {
            const html = await readFile(file, 'utf-8');
            const cps = new Set([...pageText(html)].map(c => c.codePointAt(0)));
            const faces = [];
            let bytes = 0, before = 0;
            for (const s of slices) {
              if (s === head) continue;
              const mine = [...cps].filter(c => s.cps.has(c));
              if (!mine.length) continue;
              if (!srcCache.has(s.url)) srcCache.set(s.url, await readFile(join('public', s.url)));
              const src = /** @type {Buffer} */ (srcCache.get(s.url));
              const buf = await subsetFont(src, String.fromCodePoint(...mine), { targetFormat: 'woff2' });
              const name = createHash('sha1').update(buf).digest('hex').slice(0, 12) + '.woff2';
              await writeFile(join(outDir, name), buf);
              bytes += buf.length;
              before += src.length;
              faces.push(`@font-face { font-family: 'openhuninn'; src: url('/fonts/openhuninn/page/${name}') format('woff2'); font-display: swap; unicode-range: ${toRange(mine)}; }`);
            }
            if (!faces.length) continue;
            await writeFile(file, html.replace('</head>', `<style>${faces.join('\n')}</style></head>`));
            logger.info(`${file.slice(root.length)}: 粉圓 ${faces.length} 片 ${Math.round(before / 1024)}KB → 自己的小檔 ${Math.round(bytes / 1024)}KB`);
          } catch (e) {
            // 這頁的 HTML 沒動 → 照舊用共用切片
            logger.warn(`${file.slice(root.length)}: 切粉圓小檔失敗, 這頁照舊用共用切片 (${e})`);
          }
        }
      },
    },
  };
}
