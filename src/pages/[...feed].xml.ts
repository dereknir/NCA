/**
 * RSS 訂閱: /rss.xml (全部)、/translations/rss.xml (新翻譯)、/diary/rss.xml (日記)
 * RSS 裡的連結一定要是完整網址, 所以要等網域定了 (astro.config 的 SITE / 環境變數 SITE_URL) 才產生;
 * 網址是空的時候這裡一個檔都不出, 頁首的 <link rel="alternate">、頁尾的 RSS 圖示也跟著不出現。
 * 翻譯的日期是「翻好那天」(scripts/build_translation_dates.py 從 git 算的), 不是歌的發行日;
 * 內容只放歌名、專輯, 不放歌詞 (主題標籤還沒整理, 先不放)。
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import dates from '../data/translation_dates.json';

type Item = { title: string; link: string; date: Date; desc: string; cat: string };

const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

async function translations(site: URL): Promise<Item[]> {
  const all = await getCollection('translations');
  return all.flatMap(t => {
    const d = (dates as Record<string, { translated: string | null }>)[t.id]?.translated;
    const done = t.data.instrumental || !(t.body ?? '').includes('翻譯準備中');
    if (!d || !done) return [];
    return [{ title: `${t.data.title} 中文翻譯`, link: new URL(`/translations/${t.id}/`, site).href, date: new Date(d),
      desc: `${t.data.artist}「${t.data.title}」的歌詞中文翻譯${t.data.album ? `（${t.data.album}）` : ''}。`, cat: '翻譯' }];
  });
}

async function diary(site: URL): Promise<Item[]> {
  const all = await getCollection('diary', ({ data }) => !data.isPrivate);
  return all.map(e => ({ title: e.data.title, link: new URL(`/diary/${e.id}/`, site).href, date: new Date(e.data.date),
    desc: `${new Date(e.data.date).toLocaleDateString('zh-TW', { timeZone: 'UTC' })} 的日記${e.data.mood ? ' ' + e.data.mood : ''}。`, cat: '日記' }));
}

const FEEDS: Record<string, { title: string; desc: string; page: string; get: (site: URL) => Promise<Item[]> }> = {
  rss: { title: "derekkk", desc: 'にしな 的歌詞翻譯、日記', page: '/', get: async s => [...await translations(s), ...await diary(s)] },
  'translations/rss': { title: 'derekkk · 日文歌翻譯', desc: 'にしな 的歌詞中文翻譯, 翻好一首就有一則', page: '/translations/', get: translations },
  'diary/rss': { title: 'derekkk · 日記', desc: '生活的點點滴滴', page: '/diary/', get: diary },
};

export const getStaticPaths: GetStaticPaths = () => import.meta.env.SITE ? Object.keys(FEEDS).map(feed => ({ params: { feed } })) : [];

export const GET: APIRoute = async ({ params, site }) => {
  const f = FEEDS[params.feed!];
  const items = (await f.get(site!)).sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 50);
  const self = new URL(`/${params.feed}.xml`, site).href;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(f.title)}</title>
<link>${new URL(f.page, site).href}</link>
<description>${xml(f.desc)}</description>
<language>zh-TW</language>
<atom:link href="${self}" rel="self" type="application/rss+xml"/>
${items[0] ? `<lastBuildDate>${items[0].date.toUTCString()}</lastBuildDate>\n` : ''}${items.map(it => `<item>
<title>${xml(it.title)}</title>
<link>${it.link}</link>
<guid isPermaLink="true">${it.link}</guid>
<pubDate>${it.date.toUTCString()}</pubDate>
<category>${it.cat}</category>
<description>${xml(it.desc)}</description>
</item>`).join('\n')}
</channel>
</rss>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
