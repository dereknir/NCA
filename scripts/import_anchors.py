#!/usr/bin/env python3
"""
Merge annotator output + short metadata into per-song + extras JSONs for the site.

Reads:
  annotation/shorts_anchors.json  (annotator export)
  data/nishina_shorts.json         (clean metadata for all 1283 shorts)
Writes:
  src/data/shorts_by_song.json     (grouped by real songId, for /translations/<song>/ shelves)
  src/data/shorts_extras.json      (grouped by non-song category, for /extras/ 花絮 page)

Non-song category conventions (sentinel keys stored in annotator's songId field):
  __ad     廣告
  __mc     MC / 演唱會講話
  __cover  翻唱 (非にしな 曲庫)
  __tv     節目切片
  __others 分類不出 (annotator 內部用, 不出現在網站)
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
ANCHORS_FILE = ROOT / "annotation" / "shorts_anchors.json"
SHORTS_FILE = ROOT / "data" / "nishina_shorts.json"
OUT_BY_SONG = ROOT / "src" / "data" / "shorts_by_song.json"
OUT_EXTRAS = ROOT / "src" / "data" / "shorts_extras.json"

# 網站要展示的 4 個非歌類別 (排除 __others, 那是 annotator 內部暫存桶)
EXTRA_CATEGORIES = {
    "__ad":    {"key": "ad",    "displayName": "廣告",           "emoji": "📢"},
    "__mc":    {"key": "mc",    "displayName": "MC / 演唱會講話", "emoji": "🎤"},
    "__cover": {"key": "cover", "displayName": "翻唱其他歌手",    "emoji": "🎵"},
    "__tv":    {"key": "tv",    "displayName": "節目切片",        "emoji": "📺"},
}


def build_entry(video_id: str, ann: dict, meta: dict, is_instrumental: bool) -> dict:
    """Both pipelines share this shape."""
    title = (meta.get("title") or "").split("#")[0].strip() or "YouTube Short"
    return {
        "videoId": video_id,
        "title": title,
        "url": meta.get("url") or f"https://www.youtube.com/shorts/{video_id}",
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "viewCount": meta.get("view_count") or 0,
        "versionType": ann.get("versionType"),
        "instrumental": is_instrumental,
        "anchors": ann.get("anchors") or [],
    }


def main():
    anchors = json.loads(ANCHORS_FILE.read_text(encoding="utf-8"))
    shorts_meta = json.loads(SHORTS_FILE.read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in shorts_meta["shorts"]}

    by_song = defaultdict(list)          # real songs only
    by_extra = defaultdict(list)         # non-song categories (__ad/__mc/__cover/__tv)
    skipped = {"pending": 0, "skip": 0, "no_song": 0, "no_anchors": 0, "others_bucket": 0}

    for video_id, ann in anchors.items():
        if ann.get("status") != "done":
            skipped["pending" if ann.get("status") == "pending" else "skip"] += 1
            continue
        sid = ann.get("songId")
        if not sid:
            skipped["no_song"] += 1
            continue

        is_instrumental = bool(ann.get("instrumental"))
        meta = by_id.get(video_id, {})
        entry = build_entry(video_id, ann, meta, is_instrumental)

        # 分流: 非歌類別 → shorts_extras.json (無需 anchor)
        if sid.startswith("__"):
            if sid == "__others":
                # __others 是 annotator 內部暫存桶, 不上網站
                skipped["others_bucket"] += 1
                continue
            if sid in EXTRA_CATEGORIES:
                by_extra[sid].append(entry)
            # 未知的 __-prefix 靜默忽略 (schema 保護)
            continue

        # 真歌 → shorts_by_song.json (需要 anchor, 除非 instrumental)
        if not ann.get("anchors") and not is_instrumental:
            skipped["no_anchors"] += 1
            continue
        by_song[sid].append(entry)

    # 每桶內按觀看數排序
    for sid in by_song:
        by_song[sid].sort(key=lambda x: -x["viewCount"])
    for sid in by_extra:
        by_extra[sid].sort(key=lambda x: -x["viewCount"])

    # -- 寫 shorts_by_song.json (現有格式, 除了多一個 skipped 欄位)
    OUT_BY_SONG.parent.mkdir(parents=True, exist_ok=True)
    by_song_out = {
        "meta": {
            "song_count": len(by_song),
            "short_count": sum(len(v) for v in by_song.values()),
            "skipped": skipped,
        },
        "by_song": dict(by_song),
    }
    OUT_BY_SONG.write_text(
        json.dumps(by_song_out, ensure_ascii=False, indent=2), encoding="utf-8")

    # -- 寫 shorts_extras.json (新, 給 /extras/ 頁消費)
    categories_out = {}
    for sid, entries in by_extra.items():
        info = EXTRA_CATEGORIES[sid]
        categories_out[info["key"]] = {
            "displayName": info["displayName"],
            "emoji": info["emoji"],
            "count": len(entries),
            "shorts": entries,
        }
    # 確保 4 個 category 都出現 (即使空), 讓 /extras/ 頁畫 4 個 tab
    for sid, info in EXTRA_CATEGORIES.items():
        if info["key"] not in categories_out:
            categories_out[info["key"]] = {
                "displayName": info["displayName"],
                "emoji": info["emoji"],
                "count": 0,
                "shorts": [],
            }
    extras_out = {
        "meta": {
            "total": sum(c["count"] for c in categories_out.values()),
            "by_category": {k: v["count"] for k, v in categories_out.items()},
        },
        "categories": categories_out,
    }
    OUT_EXTRAS.write_text(
        json.dumps(extras_out, ensure_ascii=False, indent=2), encoding="utf-8")

    # 摘要
    print(f"✓ Wrote {OUT_BY_SONG}")
    print(f"  {by_song_out['meta']['song_count']} songs, {by_song_out['meta']['short_count']} shorts")
    print(f"✓ Wrote {OUT_EXTRAS}")
    print(f"  {extras_out['meta']['total']} extras: {extras_out['meta']['by_category']}")
    if any(skipped.values()):
        print(f"  skipped: {skipped}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
