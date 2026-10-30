#!/usr/bin/env python3
"""
build_full_live.py — 完整 Live 的素材 → src/data/full_live.json

完整 Live = 把同一首歌、不同場次的演唱會 shorts 照歌詞順序一句一句接起來播完整首。
這裡只負責整理素材, 怎麼排段、能不能完整播放由 src/lib/fullLive.ts 決定 (建站和瀏覽器共用同一套)。

讀:
  src/data/shorts_by_song.json   審完 (status=done) 的 shorts, import_anchors.py 產出
  data/lyrics.json               每首歌的歌詞句子
  data/short_durations.json      影片長度 (fetch_short_durations.py), 判斷最後一句有沒有唱完要用
寫:
  src/data/full_live.json        { songs: [{ id, title, lines, L, shorts }] }
    L       每句大概多長 (秒): 只用 live 量 (同一支 short 相鄰兩句的時間差取中位數),
            錄音室版速度不同不拿來算; 量不到的句子用整首的中位數
    shorts  live 和其他版本 (MV 等) 都放, 純演奏的不放; am = [[句, 秒], …]

    python scripts/build_full_live.py
"""
import json
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
BY_SONG = ROOT / "src" / "data" / "shorts_by_song.json"
LYRICS = ROOT / "data" / "lyrics.json"
DURS = ROOT / "data" / "short_durations.json"
OUT = ROOT / "src" / "data" / "full_live.json"


def clean_title(t: str) -> str:
    t = re.sub(r"#\S+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def line_lengths(n: int, live: list[dict]) -> list[float]:
    found = {}
    for l in range(n):
        ds = [s["am"][l + 1] - s["am"][l] for s in live
              if l in s["am"] and l + 1 in s["am"] and 0 < s["am"][l + 1] - s["am"][l] < 20]
        if ds:
            found[l] = statistics.median(ds)
    fallback = statistics.median(found.values()) if found else 4.0
    return [round(found.get(l, fallback), 2) for l in range(n)]


def main():
    by_song = json.loads(BY_SONG.read_text(encoding="utf-8"))["by_song"]
    lyrics = {s["id"]: s for s in json.loads(LYRICS.read_text(encoding="utf-8"))["songs"]}
    durs = json.loads(DURS.read_text(encoding="utf-8")) if DURS.exists() else {}

    songs = []
    for sid, shorts in by_song.items():
        song = lyrics.get(sid)
        if not song or song.get("instrumental"):
            continue
        pool = []
        for x in shorts:
            if not x.get("anchors") or x.get("instrumental"):
                continue
            pool.append({
                "v": x["videoId"], "title": clean_title(x["title"]), "views": x["viewCount"],
                "dur": durs.get(x["videoId"]), "live": x.get("versionType") == "live",
                "type": x.get("versionType") or "other",
                "am": {a["line"]: a["t"] for a in x["anchors"]},
            })
        live = [s for s in pool if s["live"]]
        if not live:
            continue
        n = song["lyric_line_count"]
        songs.append({
            "id": sid,
            "title": song["title"],
            "lines": [{"ja": l.get("ja") or "", "zh": l.get("zh") or ""} for l in song["lyric_lines"]],
            "L": line_lengths(n, live),
            "shorts": [{**s, "am": sorted([l, round(t, 2)] for l, t in s["am"].items() if 0 <= l < n)} for s in pool],
        })

    songs.sort(key=lambda s: s["id"])
    OUT.write_text(json.dumps({"meta": {"songs": len(songs)}, "songs": songs}, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"✓ {OUT.relative_to(ROOT)} ({len(songs)} 首有 live shorts)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
