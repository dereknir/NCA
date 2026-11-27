// 「這個站怎麼運作」頁用的數字: 全部在 build 的時候從 repo 裡的資料算, 不寫死。
// 每天排程抓到新 shorts、我審完一批、翻好一首歌, 下次 build 數字就自己變。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getCollection } from 'astro:content';

const ROOT = process.cwd();
// 檔案不在或壞掉就當空的: 這頁的數字變 0, 但不要讓整站 build 失敗
const readJson = <T>(rel: string, fallback: T): T => {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf-8')) as T; } catch { return fallback; }
};

type Anchor = { t: number; line: number };
type Human = { songId?: string; anchors?: Anchor[]; status?: string };
type Auto = { songId?: string; anchors?: Anchor[]; grade?: string };

export type PipelineStats = {
  shorts: number;            // YouTube 上抓到的 shorts 總數
  scrapedAt: string;         // 最近一次抓的日期 (台北)
  reviewed: number;          // 我親手審過 (status=done)
  waiting: number;           // 還在等我審 (auto / pending)
  autoDrafts: number;        // 模型跑過初稿的 shorts
  compared: number;          // 初稿跟人工定稿都有、拿來比的支數
  autoPerfect: number;       // 初稿完全不用改 (同一首歌、句子一樣、每句時間差 ≤1 秒)
  autoLineOk: number;        // 共同句裡時間差 ≤1 秒的比例 (0~1)
  songs: number;             // 翻譯頁總數
  translated: number;        // 翻好的歌
  songsWithShorts: number;   // 有現場影片可以對的歌
  fullLive: number;          // 每一句都湊得到現場版本的歌
  workflows: number;
};

let cache: PipelineStats | undefined;

export async function getPipelineStats(): Promise<PipelineStats> {
  if (cache) return cache;

  const shortsFile = readJson<{ meta?: { scraped_at_epoch?: number }; shorts?: unknown[] }>('data/nishina_shorts.json', {});
  const human = readJson<Record<string, Human>>('annotation/shorts_anchors.json', {});
  const auto = readJson<{ items?: Record<string, Auto> }>('annotation/auto_anchors.json', {});
  const byShort = readJson<{ by_song?: Record<string, unknown[]> }>('src/data/shorts_by_song.json', {});
  const fullLive = readJson<{ songs?: unknown[] }>('src/data/full_live.json', {});
  const autoItems = auto.items ?? {};

  const humanList = Object.values(human);
  const reviewed = humanList.filter(h => h.status === 'done').length;

  // 模型初稿 vs 我的定稿: 只比兩邊都有時間點、而且我已經審完的
  let compared = 0, perfect = 0, common = 0, within1s = 0;
  for (const [vid, a] of Object.entries(autoItems)) {
    const h = human[vid];
    if (!h || h.status !== 'done' || !h.anchors?.length || !a.anchors?.length) continue;
    compared++;
    if (a.songId !== h.songId) continue;   // 認錯歌 = 整支要重標
    const hm = new Map(h.anchors.map(x => [x.line, x.t]));
    const am = new Map(a.anchors.map(x => [x.line, x.t]));
    let ok = hm.size === am.size;
    for (const [line, t] of hm) {
      const at = am.get(line);
      if (at === undefined) { ok = false; continue; }
      common++;
      if (Math.abs(at - t) <= 1) within1s++; else ok = false;
    }
    if (ok) perfect++;
  }

  const songs = await getCollection('translations');
  const translated = songs.filter(t => t.data.instrumental === true || (!!t.body && !t.body.includes('翻譯準備中'))).length;

  const epoch = shortsFile.meta?.scraped_at_epoch;
  cache = {
    shorts: shortsFile.shorts?.length ?? 0,
    scrapedAt: epoch ? new Date(epoch * 1000).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '',
    reviewed,
    waiting: humanList.length - reviewed,
    autoDrafts: Object.keys(autoItems).length,
    compared,
    autoPerfect: perfect,
    autoLineOk: common ? within1s / common : 0,
    songs: songs.length,
    translated,
    songsWithShorts: Object.values(byShort.by_song ?? {}).filter(v => v.length > 0).length,
    fullLive: fullLive.songs?.length ?? 0,
    workflows: (() => { try { return readdirSync(join(ROOT, '.github/workflows')).filter(f => /\.ya?ml$/.test(f)).length; } catch { return 0; } })(),
  };
  return cache;
}

export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
export const fmt = (n: number) => n.toLocaleString('zh-TW');
