#!/usr/bin/env python3
"""
fetch_short_durations.py — 補 shorts 影片長度 → data/short_durations.json ({videoId: 秒數})

完整 Live (scripts/build_full_live.py) 判斷「一支 short 的最後一句有沒有唱完」要知道影片多長,
但每日爬蟲用 --flat-playlist 拿不到 duration。這裡只抓有標註 anchors、快取裡又還沒有的那幾支,
所以除了第一次回填, 平常每天只會多抓個位數支。
annotation/auto_anchors.json 裡自動對齊時已經量過的長度直接拿來用, 不重抓。

    python scripts/fetch_short_durations.py            # 補缺的
    python scripts/fetch_short_durations.py --limit 50 # 這次最多抓 50 支
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data" / "short_durations.json"
ANCHORS = ROOT / "annotation" / "shorts_anchors.json"
AUTO = ROOT / "annotation" / "auto_anchors.json"


def fetch(vid: str):
    import yt_dlp
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/shorts/{vid}", download=False)
        return vid, info.get("duration")
    except Exception as e:                      # 下架 / 私人 / 網路: 這次先跳過, 下次再試
        print(f"  ✗ {vid}: {str(e).splitlines()[0][:80]}", file=sys.stderr)
        return vid, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    cache = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    if AUTO.exists():
        for vid, item in json.loads(AUTO.read_text(encoding="utf-8"))["items"].items():
            if item.get("duration") and vid not in cache:
                cache[vid] = round(float(item["duration"]), 1)

    items = json.loads(ANCHORS.read_text(encoding="utf-8"))
    items = items.get("items", items)
    todo = [vid for vid, a in items.items() if a.get("anchors") and vid not in cache]
    if args.limit:
        todo = todo[:args.limit]
    print(f"快取 {len(cache)} 支, 這次要抓 {len(todo)} 支")
    with ThreadPoolExecutor(8) as ex:
        for vid, d in ex.map(fetch, todo):
            if d:
                cache[vid] = round(float(d), 1)

    OUT.write_text(json.dumps(dict(sorted(cache.items())), ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"✓ {OUT.relative_to(ROOT)} ({len(cache)} 支)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
