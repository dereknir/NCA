#!/usr/bin/env python3
"""
build_recent_new.py — 找出本次 pipeline 新增的 shorts (對照上次執行的快照)

Reads:  data/nishina_shorts.json                 (當前所有 shorts)
        annotation/last_seen_shorts.json         (上次執行時的 videoId 全集)
Writes: annotation/recent_new_shorts.json        (本次新增列表, count + items)
        annotation/last_seen_shorts.json         (更新為當前快照)

第一次執行 (無 last_seen): 靜默 seed baseline, 回報 0 new
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
CURRENT = ROOT / 'data' / 'nishina_shorts.json'
LAST_SEEN = ROOT / 'annotation' / 'last_seen_shorts.json'
OUT = ROOT / 'annotation' / 'recent_new_shorts.json'


def main():
    data = json.loads(CURRENT.read_text(encoding='utf-8'))
    current_shorts = data['shorts']
    current_set = {s['id'] for s in current_shorts}

    first_run = not LAST_SEEN.exists()
    if first_run:
        new_ids = set()
    else:
        last_seen = set(json.loads(LAST_SEEN.read_text(encoding='utf-8')))
        new_ids = current_set - last_seen

    new_items = [
        {
            'videoId': s['id'],
            'title': s['title'],
            'viewCount': s.get('view_count'),
            'thumbnail': s.get('thumbnail'),
            'url': s.get('url'),
        }
        for s in current_shorts
        if s['id'] in new_ids
    ]
    new_items.sort(key=lambda x: -(x.get('viewCount') or 0))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {'count': len(new_items), 'firstRun': first_run, 'items': new_items},
            ensure_ascii=False, indent=2,
        ),
        encoding='utf-8',
    )
    # 更新 last_seen 供下次比對
    LAST_SEEN.write_text(
        json.dumps(sorted(current_set), ensure_ascii=False),
        encoding='utf-8',
    )

    print(f'✓ recent new: {len(new_items)} (first run: {first_run})')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
