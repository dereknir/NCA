// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://derekni.com',
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
    // sitemap-index.xml + sitemap-0.xml; robots.txt 指向它
    sitemap({
      // 內部工具不進 sitemap (robots.txt 也 Disallow)
      filter: (page) => !page.includes('/admin'),
      // public/ 下不經 Astro 路由的靜態子站, sitemap 掃不到, 手動列 (與 NAVIGATION 對齊)
      customPages: [
        'https://derekni.com/lyric-universe/',
        'https://derekni.com/kwic/',
        'https://derekni.com/star-map/',
        'https://derekni.com/live/timeline/',
        'https://derekni.com/live/concerts/',
        'https://derekni.com/live/footprint/',
        'https://derekni.com/gacha/',
        'https://derekni.com/galaxy/',
      ],
    }),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      // langs 只收自訂 LanguageRegistration; js/ts/python/bash/markdown 都是 shiki 內建, 不用列
    },
  },
});
