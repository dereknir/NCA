// 有網域 (SITE_URL) 時, 把 Astro 管不到的地方也補齊; 沒網域時什麼都不做。
// - public/ 下的靜態子站 (歌詞宇宙、live 三頁…): og:image 改成完整網址、補 canonical 與 og:url
//   (社群平台抓分享圖只認完整網址; Astro 頁面的這些由 BaseLayout 處理)
// - robots.txt 補上 Sitemap: 那一行
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** @param {{ site: string | undefined, staticPages: string[] }} opts */
export default function siteUrl({ site, staticPages }) {
  return {
    name: 'site-url',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        if (!site) return;
        const root = fileURLToPath(dir);
        const abs = (/** @type {string} */ p) => new URL(p, site).href;
        let fixed = 0;
        for (const page of staticPages) {
          const file = join(root, page, 'index.html');
          let html;
          try { html = await readFile(file, 'utf-8'); } catch { continue; }
          const before = html;
          html = html.replace(/(<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content=")(\/[^"]*)"/g,
            (_, head, path) => `${head}${abs(path)}"`);
          const extra = [];
          if (!/rel="canonical"/.test(html)) extra.push(`<link rel="canonical" href="${abs(page)}">`);
          if (!/property="og:url"/.test(html)) extra.push(`<meta property="og:url" content="${abs(page)}">`);
          if (extra.length) html = html.replace('</head>', `${extra.join('')}</head>`);
          if (html !== before) { await writeFile(file, html); fixed++; }
        }
        const robots = join(root, 'robots.txt');
        try {
          const txt = await readFile(robots, 'utf-8');
          if (!/^Sitemap:/m.test(txt)) await writeFile(robots, `${txt.trimEnd()}\nSitemap: ${abs('/sitemap-index.xml')}\n`);
        } catch { /* 沒有 robots.txt 就不補 */ }
        logger.info(`靜態子站補完整網址 ${fixed} 頁; robots.txt 加上 Sitemap`);
      },
    },
  };
}
