#!/usr/bin/env python3
"""
Merge annotator output + short metadata into a per-song JSON for the site.

Reads:
  annotation/shorts_anchors.json  (annotator export)
  data/nishina_shorts.json         (clean metadata for all 1283 shorts)
Writes:
  src/data/shorts_by_song.json     (grouped by songId, ready for Astro consumption)
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
ANCHORS_FILE = ROOT / "annotation" / "shorts_anchors.json"
SHORTS_FILE = ROOT / "data" / "nishina_shorts.json"
OUT_FILE = ROOT / "src" / "data" / "shorts_by_song.json"


def main():
    anchors = json.loads(ANCHORS_FILE.read_text(encoding="utf-8"))
    shorts_meta = json.loads(SHORTS_FILE.read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in shorts_meta["shorts"]}

    by_song = defaultdict(list)
    skipped = {"pending": 0, "skip": 0, "no_song": 0, "no_anchors": 0}

    for video_id, ann in anchors.items():
        if ann.get("status") != "done":
            skipped["pending" if ann.get("status") == "pending" else "skip"] += 1
            continue
        sid = ann.get("songId")
        if not sid:
            skipped["no_song"] += 1
            continue
        is_instrumental = bool(ann.get("instrumental"))
        # 純演奏 shorts 允許空 anchors; 其他必須有 anchors 才收
        if not ann.get("anchors") and not is_instrumental:
            skipped["no_anchors"] += 1
            continue

        meta = by_id.get(video_id, {})
        # 標題去掉 hashtags 讓 UI 顯示乾淨
        title = (meta.get("title") or "").split("#")[0].strip() or "YouTube Short"
        by_song[sid].append({
            "videoId": video_id,
            "title": title,
            "url": meta.get("url") or f"https://www.youtube.com/shorts/{video_id}",
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "viewCount": meta.get("view_count") or 0,
            "versionType": ann.get("versionType"),
            "instrumental": is_instrumental,
            "anchors": ann.get("anchors") or [],
        })

    # 每首歌內按觀看數排序
    for sid in by_song:
        by_song[sid].sort(key=lambda x: -x["viewCount"])

    output = {
        "meta": {
            "song_count": len(by_song),
            "short_count": sum(len(v) for v in by_song.values()),
            "skipped": skipped,
        },
        "by_song": dict(by_song),
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✓ Wrote {OUT_FILE}")
    print(f"  {output['meta']['song_count']} songs, {output['meta']['short_count']} shorts")
    if any(skipped.values()):
        print(f"  skipped: {skipped}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
