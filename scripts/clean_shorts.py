#!/usr/bin/env python3
"""
clean_shorts.py — raw yt-dlp JSONL → 精簡 nishina_shorts.json

從 yt-dlp --dump-json 的每行大物件中抽取 site 需要的欄位:
  id / title / url / view_count / thumbnail / playlist_index
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
IN_FILE = ROOT / 'data' / 'nishina_shorts_raw.jsonl'
OUT_FILE = ROOT / 'data' / 'nishina_shorts.json'


def main():
    if not IN_FILE.exists():
        print(f'error: {IN_FILE.relative_to(ROOT)} 不存在, 先跑 scrape 步驟', file=sys.stderr)
        sys.exit(1)

    items, first = [], None
    with open(IN_FILE, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if first is None:
                first = r
            items.append({
                'id': r.get('id'),
                'title': r.get('title', ''),
                'url': r.get('webpage_url') or r.get('url'),
                'view_count': r.get('view_count'),
                'thumbnail': (r.get('thumbnails') or [{}])[0].get('url'),
                'playlist_index': r.get('playlist_index'),
            })

    meta = {
        'channel': (first or {}).get('playlist_channel', ''),
        'channel_id': (first or {}).get('playlist_channel_id', ''),
        'channel_url': (first or {}).get('playlist_webpage_url', ''),
        'total_count': len(items),
        'scraped_at_epoch': (first or {}).get('epoch', 0),
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps({'meta': meta, 'shorts': items}, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )
    print(f'✓ {OUT_FILE.relative_to(ROOT)} — {len(items)} shorts')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
