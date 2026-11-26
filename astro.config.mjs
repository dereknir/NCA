// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';

// 正式網域還沒定: 買好之後填在這裡 (例 'https://example.com'), 或在 Vercel 設環境變數 SITE_URL,
// sitemap、canonical、og:image 絕對網址、RSS 會一起打開。留空時這些都不輸出。
const SITE = process.env.SITE_URL || undefined;

// public/ 下不經 Astro 路由的靜態子站, sitemap 掃不到, 手動列 (與 NAVIGATION 對齊)
const STATIC_PAGES = ['/lyric-universe/', '/kwic/', '/star-map/', '/live/timeline/', '/live/concerts/',
  '/live/footprint/', '/gacha/', '/galaxy/'];

// 中文的粗體: markdown 規定 `**` 前面是字、後面緊接標點 (例「是**「啟程」**。」) 時不算粗體開頭,
// 中文這樣寫很常見, 結果畫面上出現星號, 甚至跟下一組粗體配錯對。
// build 的時候: 段落 / 標題的原文裡有 ** 的, 把星號照順序兩兩換成 <strong></strong> 再重新解析
// (標籤不吃那條規則; 中間的連結、斜體照樣是 markdown)。md 照常用 ** 寫, 原檔不動。
// 行內程式碼 `…` 裡的星號、跳脫的 \*\* 不算; 單數多出來的最後一個保持原樣。
// 注意: 只改這幾個函式的內容, Astro 不會重新渲染沒改過的 md (快取在 node_modules/.astro), 本機要先刪掉那個資料夾再 build
/** @param {string} src */
function strongTags(src) {
  let open = false;
  const parts = src.split(/(`+[^`]*`+)/);   // 奇數位置是行內程式碼, 不碰
  const fixed = parts.map((/** @type {string} */ p, /** @type {number} */ i) => i % 2 ? p : p.replace(/(?<!\\)\*\*(?!\*)/g, () => (open = !open) ? '<strong>' : '</strong>'));
  if (!open) return fixed.join('');
  // 單數: 最後一個換錯了, 還原成 **
  const out = fixed.join(''), k = out.lastIndexOf('<strong>');
  return out.slice(0, k) + '**' + out.slice(k + 8);
}
/** @param {any} node satteri mdast 節點 @param {any} ctx satteri 外掛 context */
function fixBold(node, ctx) {
  const p = node.position;
  if (!p) return;
  const src = ctx.source.slice(p.start.offset, p.end.offset);
  if (!src.includes('**') || /\n\s*>/.test(src)) return;   // 引用區塊裡跨行的段落切出來會變形, 不碰
  const out = strongTags(src);
  if (out !== src) ctx.replaceNode(node, { raw: out });
}
// 表格的格子不是段落, 不能整格重新解析: 格子裡同一段文字還留著的 **…** 直接補成粗體
const BOLD = /\*\*(?=\S)([^*]*?\S)\*\*/g;
/** @param {any} node @param {any} ctx */
function fixCellText(node, ctx) {
  if (!node.value.includes('**') || ctx.parent(node)?.type !== 'tableCell') return;
  const out = [];
  let last = 0;
  for (const m of node.value.matchAll(BOLD)) {
    if (m.index > last) out.push({ type: 'text', value: node.value.slice(last, m.index) });
    out.push({ type: 'strong', children: [{ type: 'text', value: m[1] }] });
    last = m.index + m[0].length;
  }
  if (!last) return;
  if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
  ctx.replaceNode(node, out);
}
const cjkBold = { name: 'cjk-bold', options: { position: true }, paragraph: fixBold, heading: fixBold, text: fixCellText };

// https://astro.build/config
export default defineConfig({
  site: SITE,
  output: 'static',
  // 純靜態網站不需要 adapter，Vercel 會自動偵測並部署
  // Astro 7 把 compressHTML default 從 true 改為 'jsx' (inline element 間空白會被吃掉)
  // 顯式設回 true 保留 v6 行為, 避免 zh/ja 混排文本被意外壓縮
  compressHTML: true,
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    mdx(),
    // sitemap-index.xml + sitemap-0.xml (要有網域才產得出來)
    ...(SITE ? [sitemap({
      // 內部工具不進 sitemap (robots.txt 也 Disallow)
      filter: (page) => !page.includes('/admin'),
      customPages: STATIC_PAGES.map(p => new URL(p, SITE).href),
    })] : []),
  ],
  markdown: {
    processor: satteri({ mdastPlugins: [cjkBold] }),
    shikiConfig: {
      theme: 'github-dark',
      // langs 只收自訂 LanguageRegistration; js/ts/python/bash/markdown 都是 shiki 內建, 不用列
    },
  },
});
