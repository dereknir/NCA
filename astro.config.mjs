// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';

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
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      langs: ['javascript', 'typescript', 'python', 'bash', 'markdown'],
    },
  },
});
