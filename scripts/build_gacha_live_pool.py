"""
build_gacha_live_pool.py — 從 annotation/shorts_anchors.json 生 gacha LIVE 池

規則:
- status == 'done' 且 !instrumental 的 short 才計入
- songId 為真 (非空、非 __others)
- 每個 (songId, lineIndex) 只算一次
- 輸出 public/gacha/live_pool.json,格式對齊 gacha.html 內 CURATED.LIVE:
    ["nishina-plum#14", "nishina-mashiro#3", ...]
"""
import json
import sys
from pathlib import Path
from collections import Counter

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent
ANCHORS = ROOT / 'annotation' / 'shorts_anchors.json'
POOL = ROOT / 'public' / 'gacha' / 'pool.json'
OUT = ROOT / 'public' / 'gacha' / 'live_pool.json'


def main():
    # pool.json 為權威 — 只保留能對到 pool 裡實際存在行 index 的 anchor
    pool = json.loads(POOL.read_text(encoding='utf-8'))
    valid = {s['id']: {l['i'] for l in s['lines']} for s in pool['pool']}

    data = json.loads(ANCHORS.read_text(encoding='utf-8'))
    pairs = set()
    dropped_missing_song = 0
    dropped_missing_line = 0
    for v in data.values():
        if v.get('status') != 'done':
            continue
        if v.get('instrumental'):
            continue
        sid = v.get('songId')
        if not sid or sid == '__others':
            continue
        for a in v.get('anchors', []):
            line_idx = a.get('line')
            if line_idx is None:
                continue
            line_idx = int(line_idx)
            if sid not in valid:
                dropped_missing_song += 1
                continue
            if line_idx not in valid[sid]:
                dropped_missing_line += 1
                continue
            pairs.add((sid, line_idx))

    ids = sorted(f"{s}#{i}" for s, i in pairs)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(ids, ensure_ascii=False, indent=2), encoding='utf-8')

    song_counts = Counter(s for s, _ in pairs)
    print(f'[gacha/live_pool] {len(ids)} unique identities across {len(song_counts)} songs -> {OUT}')
    if dropped_missing_song or dropped_missing_line:
        print(f'  dropped: {dropped_missing_song} anchor(s) on song not in pool, '
              f'{dropped_missing_line} anchor(s) on line not in pool')
    for sid, n in song_counts.most_common(5):
        print(f'  {sid}: {n} lines')


if __name__ == '__main__':
    main()
