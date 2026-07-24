#!/usr/bin/env python3
"""
Export all translated songs into a single JSON file for downstream tooling
(e.g. lyric-line matching against YouTube Shorts titles).

Reads   : src/content/translations/*.md
Writes  : data/lyrics.json
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC_DIR = ROOT / "src" / "content" / "translations"
OUT_FILE = ROOT / "data" / "lyrics.json"


FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

# frontmatter parsers (very small subset — arrays with quoted items, scalars)
_ARRAY_RE = re.compile(r"^\[(.*)\]$")
_ARRAY_ITEM_RE = re.compile(r"\"([^\"]*)\"")


def parse_scalar(v: str):
    v = v.strip()
    if v == "":
        return None
    if v.lower() in ("true", "false"):
        return v.lower() == "true"
    # array literal on one line
    m = _ARRAY_RE.match(v)
    if m:
        return _ARRAY_ITEM_RE.findall(m.group(1))
    # quoted string
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    return v


def parse_frontmatter(text: str) -> dict:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    raw = m.group(1)
    fm = {}
    for line in raw.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        fm[key.strip()] = parse_scalar(val)
    return fm


# Locate the lyric block area by anchoring on the "歌詞 / 翻譯" H2 (or fallback: whole body).
LYRICS_H2_RE = re.compile(r"##\s*歌詞[^\n]*\n(.*?)(?=\n---|\n##|\Z)", re.DOTALL)
# Sub-div (romaji / ja / zh) — HTML in these files is on its own line, so a single-line
# non-greedy match to the very next </div> is safe.
SUB_DIV_RE = re.compile(r'<div class="(romaji|ja|zh)">([^<]*)</div>')


# Legacy YOASOBI-style format: <div class="lyrics-container"> with <div class="lyrics-ja">…<br/>…</div>
LEGACY_CONTAINER_RE = re.compile(r'<div class="lyrics-container">(.*?)</div>\s*</div>', re.DOTALL)
LEGACY_JA_RE = re.compile(r'<div class="lyrics-ja">(.*?)</div>', re.DOTALL)
LEGACY_ZH_RE = re.compile(r'<div class="lyrics-zh">(.*?)</div>', re.DOTALL)


def _split_br(text: str) -> list[str]:
    parts = re.split(r"<br\s*/?>", text)
    return [p.strip() for p in parts if p.strip()]


def parse_lyric_lines(body: str) -> list[dict]:
    """Walk sub-divs in document order. Start a new lyric line whenever we
    encounter a field that's already filled in the current in-progress line
    (e.g. seeing a 2nd 'ja' means the previous line is complete)."""
    m = LYRICS_H2_RE.search(body)
    scope = m.group(1) if m else body

    lines: list[dict] = []
    current: dict = {}
    for match in SUB_DIV_RE.finditer(scope):
        key, value = match.group(1), match.group(2).strip()
        if key in current:
            lines.append(current)
            current = {}
        current[key] = value
    if current:
        lines.append(current)

    # Fallback: legacy lyrics-container format (e.g. yoasobi-yoru-ni-kakeru)
    if not lines:
        for cmatch in LEGACY_CONTAINER_RE.finditer(scope):
            block = cmatch.group(1)
            ja_match = LEGACY_JA_RE.search(block)
            zh_match = LEGACY_ZH_RE.search(block)
            ja_lines = _split_br(ja_match.group(1)) if ja_match else []
            zh_lines = _split_br(zh_match.group(1)) if zh_match else []
            for i in range(max(len(ja_lines), len(zh_lines))):
                lines.append({
                    "ja": ja_lines[i] if i < len(ja_lines) else None,
                    "zh": zh_lines[i] if i < len(zh_lines) else None,
                })

    return [
        {"index": i, "romaji": ln.get("romaji"), "ja": ln.get("ja"), "zh": ln.get("zh")}
        for i, ln in enumerate(lines)
    ]


def slugify_filename(path: Path) -> str:
    """`nishina-plum.md` -> `nishina-plum`."""
    return path.stem


def main():
    files = sorted(SRC_DIR.glob("*.md"))
    songs = []

    for path in files:
        text = path.read_text(encoding="utf-8")
        fm = parse_frontmatter(text)
        body = text[text.find("---", 3) + 3:] if text.startswith("---") else text
        lyric_lines = parse_lyric_lines(body)

        songs.append({
            "id": slugify_filename(path),
            "title": fm.get("title"),
            "artist": fm.get("artist"),
            "album": fm.get("album"),
            "album_year": fm.get("albumYear"),
            "track_number": fm.get("trackNumber"),
            "publish_date": fm.get("publishDate"),
            "lyricist": fm.get("lyricist"),
            "composer": fm.get("composer"),
            "arranger": fm.get("arranger"),
            "tags": fm.get("tags"),
            "instrumental": fm.get("instrumental") or False,
            "exclude_from_lyric_analysis": fm.get("excludeFromLyricAnalysis") or False,
            "cover_image": fm.get("coverImage"),
            "detail_url": f"/translations/{slugify_filename(path)}/",
            "lyric_lines": lyric_lines,
            "lyric_line_count": len(lyric_lines),
        })

    output = {
        "meta": {
            "source": "src/content/translations/*.md",
            "song_count": len(songs),
            "total_lyric_lines": sum(s["lyric_line_count"] for s in songs),
            "schema": {
                "song": {
                    "id": "kebab-case filename stem (nishina-plum, yoasobi-yoru-ni-kakeru)",
                    "title": "canonical Japanese title",
                    "album": "album name",
                    "album_year": "int",
                    "track_number": "int, 1-based",
                    "publish_date": "YYYY-MM-DD",
                    "instrumental": "bool — true means no lyric_lines by design",
                    "lyric_lines": "array of {index, romaji, ja, zh}",
                },
                "lyric_line": {
                    "index": "0-based line index within the song",
                    "romaji": "Latin transliteration (may be null on interlude spacers)",
                    "ja": "original Japanese line — PRIMARY matching field for shorts titles",
                    "zh": "traditional Chinese translation",
                },
            },
        },
        "songs": songs,
    }

    OUT_FILE.parent.mkdir(exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f"✓ Wrote {OUT_FILE}")
    print(f"  Songs: {len(songs)}")
    print(f"  Total lyric lines: {output['meta']['total_lyric_lines']}")
    print(f"  Size: {size_kb:.1f} KB")

    # sanity: show any song that failed to parse lyrics
    no_lyrics = [s for s in songs if s["lyric_line_count"] == 0 and not s["instrumental"]]
    if no_lyrics:
        print(f"\n⚠  {len(no_lyrics)} songs have no parsed lyrics (and are not marked instrumental):")
        for s in no_lyrics:
            print(f"    - {s['id']}  ({s['title']})")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
