#!/usr/bin/env python3
"""
build_annotation_queue.py
把 yt-dlp 抓的 shorts 原始資料配對到歌曲,產出標注工具的待辦佇列。

輸入:
  nishina_shorts_raw.jsonl  (yt-dlp --flat-playlist --dump-json 輸出)
  lyrics.json               (網站歌詞庫, meta.schema 有完整欄位說明)
輸出:
  annotation_queue.json     (標注工具讀這個)
  review_queue.json         (配不到 / 低信心的,人工看)

用法: python build_annotation_queue.py [--top-n 3]
"""

import json, re, sys, unicodedata
from collections import defaultdict
from rapidfuzz import fuzz

TOP_N = 0  # 每首歌保留觀看數最高的前 N 支;0 = 全留(預設,以確保 1283 都能標到)
if '--top-n' in sys.argv:
    TOP_N = int(sys.argv[sys.argv.index('--top-n') + 1])

# 特殊分組 key,收攏所有 songId 為 null 的 shorts(review/庫外/非歌曲)
UNMATCHED_KEY = '__unmatched'

GENERIC_TAGS = {
    'にしな', 'nishina', 'ライブ', 'shorts', 'short', '弾き語り', 'live',
    'ワンマン', 'ツアー', '歌ってみた', '新曲', 'mv', 'tiktok', 'fyp',
    'newmusic', 'jpop', 'music', 'thefirsttake', 'newsong', 'musicvideo',
    'japanesemusic',
}
DATE_PAT = re.compile(r'^\d{4}\.\d{1,2}\.\d{1,2}\s')
NON_SONG_PAT = re.compile(r'よりみち|^📺')

# 純標題比對的閾值(rapidfuzz partial_ratio, 0-100)
ACCEPT = 85   # >= 這個分數直接採用
REVIEW = 65   # 介於中間 → review;更低 → 視為庫外歌曲(cover 等)


def norm(s: str) -> str:
    """NFKC 正規化 + 去空白標點,讓全半形/空格差異不影響比對"""
    s = unicodedata.normalize('NFKC', s)
    return re.sub(r'[\s\u3000、。,.!?！?？…・「」『』()（）\-~〜]', '', s).lower()


def load_songs(path):
    data = json.load(open(path, encoding='utf-8'))
    songs = [s for s in data['songs'] if not s.get('instrumental')]
    # hashtag 別名表: 正規化後的名稱 -> song id
    alias = {}
    for s in songs:
        alias[norm(s['title'])] = s['id']
        # id 去掉 artist 前綴也當別名 (nishina-plum -> plum)
        stem = s['id'].split('-', 1)[-1]
        alias[norm(stem)] = s['id']
    # 歌詞行索引: [(song_id, line_index, normalized_ja)]
    lines = []
    for s in songs:
        for ln in s['lyric_lines']:
            if ln.get('ja'):
                lines.append((s['id'], ln['index'], norm(ln['ja'])))
    return songs, alias, lines


def classify(rec, alias, lines):
    """回傳 (bucket, song_id, line_hint, score)"""
    title = rec['title']
    lyric_text = title.split('#')[0].strip()
    tags = [t for t in re.findall(r'#([^#\s]+)', title)
            if norm(t) not in {norm(g) for g in GENERIC_TAGS}]

    if DATE_PAT.match(lyric_text) or NON_SONG_PAT.search(title):
        return 'non_song', None, None, None

    # 1) hashtag 直接命中
    for t in tags:
        sid = alias.get(norm(t))
        if sid:
            # 命中後仍嘗試找 line_hint(標題那句歌詞在歌裡的位置)
            hint, score = best_line(lyric_text, [l for l in lines if l[0] == sid])
            return 'hashtag', sid, hint, score

    # 2) 標題歌詞句 vs 全庫模糊比對
    if not lyric_text:
        return 'review', None, None, None
    (sid, hint), score = best_line_global(lyric_text, lines)
    if score >= ACCEPT:
        return 'lyric_match', sid, hint, score
    if score >= REVIEW:
        return 'review', sid, hint, score
    return 'out_of_catalog', None, None, score  # 多半是 cover 或庫外曲


def best_line(lyric_text, song_lines):
    q = norm(lyric_text)
    best, best_score = None, -1
    for _, idx, nja in song_lines:
        sc = fuzz.partial_ratio(q, nja)
        if sc > best_score:
            best, best_score = idx, sc
    return best, best_score


def best_line_global(lyric_text, lines):
    q = norm(lyric_text)
    best, best_score = (None, None), -1
    for sid, idx, nja in lines:
        sc = fuzz.partial_ratio(q, nja)
        if sc > best_score:
            best, best_score = (sid, idx), sc
    return best, best_score


def main():
    songs, alias, lines = load_songs('lyrics.json')
    recs = [json.loads(l) for l in open('nishina_shorts_raw.jsonl', encoding='utf-8')]

    by_song = defaultdict(list)
    unmatched = []                 # review + out_of_catalog + non_song 全部歸這
    review, non_song, out_cat = [], [], []
    stats = defaultdict(int)

    for r in recs:
        bucket, sid, hint, score = classify(r, alias, lines)
        stats[bucket] += 1
        # 全部走高解析度 thumbnail (yt-dlp 首個 index 常是縮圖)
        thumb_hq = f"https://i.ytimg.com/vi/{r['id']}/hqdefault.jpg"
        item = {
            'videoId': r['id'],
            'title': r['title'],
            'viewCount': r.get('view_count') or 0,
            'thumbnail': thumb_hq,
            'songId': sid,
            'lineHint': hint,        # 標題那句最可能對應的歌詞行 → 標注工具預選它
            'matchScore': score,
            'matchMethod': bucket,
        }
        if bucket in ('hashtag', 'lyric_match'):
            by_song[sid].append(item)
        else:
            unmatched.append(item)
            if bucket == 'review':
                review.append(item)
            elif bucket == 'out_of_catalog':
                out_cat.append(item)
            else:
                non_song.append(item)

    # 每首歌按觀看數排序,取 TOP_N
    queue = {}
    for sid, items in by_song.items():
        items.sort(key=lambda x: -x['viewCount'])
        queue[sid] = items[:TOP_N] if TOP_N else items
    # 未 match 的按觀看數排序,一併塞進 queue 供人工指定歌曲
    unmatched.sort(key=lambda x: -x['viewCount'])
    queue[UNMATCHED_KEY] = unmatched

    total_q = sum(len(v) for v in queue.values())
    json.dump(
        {'meta': {'topN': TOP_N, 'totalInQueue': total_q,
                  'songCount': len(queue) - 1,  # 扣掉 __unmatched
                  'unmatchedCount': len(unmatched)},
         'queue': queue},
        open('annotation_queue.json', 'w', encoding='utf-8'),
        ensure_ascii=False, indent=2)
    # review_queue 保留給 QA 參考,不再是主要輸入
    json.dump({'review': review, 'outOfCatalog': out_cat, 'nonSong': non_song},
              open('review_queue.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    print('分類統計:', dict(stats))
    print(f'標注佇列: {len(queue)-1} 首歌 / {total_q} 支 shorts (top {TOP_N or "全部"})')
    print(f'  其中 __unmatched: {len(unmatched)} 支 (review={len(review)}, 庫外={len(out_cat)}, 非歌曲={len(non_song)})')


if __name__ == '__main__':
    main()
