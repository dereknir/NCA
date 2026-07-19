#!/usr/bin/env python3
"""
Classify nishina YouTube Shorts into 4 buckets:
  1. 有歌名 hashtag  — 標題含已知歌名 hashtag，程式直接配對
  2. 只有歌詞句      — hashtag 只剩通用 tag，標題開頭是一句歌詞
  3. 公演日期宣傳    — 「2026.5.30 at CRAZYMAMA KINGDOM」這種，排除
  4. よりみち／企劃  — 電視企劃、對談等，排除

Input : data/nishina_shorts.json
Output: data/nishina_shorts_classified.json
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
IN_FILE = ROOT / "data" / "nishina_shorts.json"
OUT_FILE = ROOT / "data" / "nishina_shorts_classified.json"

# ---- Canonical song list -----------------------------------------------------
# Includes: all 43 translated songs + new songs from 2024-2026 interviews.
# Each entry: (canonical_display_name, [aliases used as hashtags])
SONGS = [
    ("1999",                        ["1999"]),
    ("intro",                       ["intro"]),
    ("アイニコイ",                     ["アイニコイ", "ainikoi"]),
    ("bugs",                        ["bugs", "BUGS", "BUGSbugs"]),
    ("centi",                       ["centi", "CENTI"]),
    ("クランベリージャムをかけて",       ["クランベリージャムをかけて", "クランベリージャム", "cranberryjam"]),
    ("ダーリン",                      ["ダーリン", "darling"]),
    ("debbie",                      ["debbie", "DEBBIE"]),
    ("FRIDAY KIDS CHINA TOWN",      ["FRIDAY KIDS CHINA TOWN", "FRIDAYKIDSCHINATOWN", "fridaykidschinatown"]),
    ("春一番",                       ["春一番", "haruichiban"]),
    ("ヘビースモーク",                 ["ヘビースモーク", "heavysmoke", "ヘビスモ"]),
    ("秘密基地",                     ["秘密基地", "himitsukichi"]),
    ("ホットミルク",                   ["ホットミルク", "hotmilk"]),
    ("It's a piece of cake",        ["It's a piece of cake", "itsapieceofcake", "pieceofcake"]),
    ("ケダモノのフレンズ",              ["ケダモノのフレンズ", "kedamononofriends", "ケダモノフレンズ"]),
    ("真白",                        ["真白", "mashiro"]),
    ("モモ",                        ["モモ", "momo"]),
    ("ねこぜ",                       ["ねこぜ", "nekoze"]),
    ("ワンルーム",                    ["ワンルーム", "oneroom", "1room"]),
    ("plum",                        ["plum", "PLUM"]),
    ("ランデブー",                    ["ランデブー", "randevu", "randebu", "rendezvous"]),
    ("青藍遊泳",                     ["青藍遊泳", "seiranyuei"]),
    ("スローモーション",                ["スローモーション", "slowmotion"]),
    ("シュガースポット",               ["シュガースポット", "sugarspot"]),
    ("東京マーブル",                  ["東京マーブル", "tokyomarble"]),
    ("桃源郷",                      ["桃源郷", "tougenkyou", "tougenkyo"]),
    ("透明な黒と鉄分のある赤",          ["透明な黒と鉄分のある赤", "透明な黒", "toumeinakuro"]),
    ("つくし",                       ["つくし", "tsukushi"]),
    ("Twinkle Little Star",         ["Twinkle Little Star", "TwinkleLittleStar", "twinklelittlestar"]),
    ("U+",                          ["U+", "U", "Uplus", "uplus"]),
    ("わをん",                       ["わをん", "wawon", "waon"]),
    ("weekly",                      ["weekly", "WEEKLY"]),
    ("夜間飛行",                     ["夜間飛行", "yakanhikou", "yakanhiko"]),
    ("夜になって",                    ["夜になって", "yoruninatte"]),
    ("夜に駆ける",                    ["夜に駆ける", "yorunikakeru", "yoasobi"]),
    # ---- 日々散漫 (2025-2026) new songs from interviews/tour ----
    ("婀娜婀娜",                     ["婀娜婀娜", "adaada"]),
    ("in your eyes",                ["in your eyes", "inyoureyes"]),
    ("ドレスコード",                   ["ドレスコード", "dresscode"]),
    ("音になっていくよ",               ["音になっていくよ", "otoninatteikuyo"]),
    ("グローリー",                    ["グローリー", "glory"]),
    ("今日も今日とて",                ["今日も今日とて", "今日も今日とて remix", "kyoumokyoutote"]),
    ("パンダガール",                   ["パンダガール", "pandagirl"]),
    ("輪廻",                        ["輪廻", "rinne"]),
    # ---- other referenced tracks ----
    ("じゃじゃ馬にさせないで",           ["じゃじゃ馬にさせないで", "jajaumanisasenaide"]),
    ("harmonic flight",             ["harmonic flight", "harmonicflight"]),
    ("あれが恋だったのかな",             ["あれが恋だったのかな"]),  # くじら feat.にしな
    ("水仙",                        ["水仙"]),  # GeG feat.にしな
    ("藍",                          ["藍"]),
    ("クローバー",                    ["クローバー", "clover"]),
    ("モブ子の恋",                    ["モブ子の恋", "mobukonokoi"]),
    ("日々散漫",                     ["日々散漫", "hibisanman"]),  # both album and title track
    ("うるわしきひと",                 ["うるわしきひと"]),
    ("夜凪",                        ["夜凪"]),
]

# Noise tags — generic promotion/genre/language tags, ignore
NOISE_TAGS = {
    "shorts", "short", "shortsvideo", "shortvideo", "shortmusic",
    "にしな", "nishina", "nishinaofficial", "nishina_official",
    "ライブ", "live", "livemusic",
    "ミュージックビデオ", "musicvideo", "mv",
    "lyrics", "lyric", "lyricvideo",
    "song", "music", "newsong", "newmusic", "newrelease",
    "jpop", "j-pop", "jpopsongs", "jpopmusic", "jpopvibes",
    "jpoprock", "japanmusic", "japan", "japanese", "japanesemusic",
    "japanesesong", "asianmusic",
    "ballad", "rock", "pop",
    "thefirsttake", "firsttake",
    "anime", "animesong", "animesongs",
    "spotify", "applemusic", "youtubemusic",
    "cover", "acoustic",
    "オフィシャル", "official",
    "indigolaend",  # producer name (くじら's band, not song title)
    "くじら", "kujira", "geg",
}


def normalize(s: str) -> str:
    """Lowercase, strip whitespace/punctuation for hashtag matching."""
    s = s.lower().strip()
    s = re.sub(r"[\s'’`\-_.]", "", s)
    return s


# Build alias -> canonical_name lookup
ALIAS_TO_SONG = {}
for canonical, aliases in SONGS:
    for alias in aliases:
        ALIAS_TO_SONG[normalize(alias)] = canonical


def extract_hashtags(title: str) -> list[str]:
    """Return raw hashtag strings from title (without the '#')."""
    return re.findall(r"#([^\s#]+)", title)


def match_song_tag(tags: list[str]) -> str | None:
    """If any hashtag maps to a known song, return that canonical name."""
    for tag in tags:
        n = normalize(tag)
        if n in ALIAS_TO_SONG:
            return ALIAS_TO_SONG[n]
    return None


# Pre-sort aliases longest-first so "It's a piece of cake" beats "cake" etc.
_ALL_ALIASES_SORTED = sorted(
    ((alias, canonical) for canonical, aliases in SONGS for alias in aliases),
    key=lambda x: -len(x[0]),
)


def match_song_in_text(title: str) -> str | None:
    """Strip hashtags then look for an exact song alias appearing in the
    remaining text. Match must be at least 2 chars to avoid false positives
    like 'U' alone. Skips very short one-char aliases entirely."""
    # remove hashtag segments (# followed by non-space)
    clean = re.sub(r"#[^\s#]+", "", title).strip()
    if not clean:
        return None
    clean_n = normalize(clean)
    for alias, canonical in _ALL_ALIASES_SORTED:
        if len(alias) < 2:
            continue
        if normalize(alias) in clean_n:
            return canonical
    return None


# Date/venue patterns for tour announcement detection
DATE_RE = re.compile(r"\d{4}[./\-]\d{1,2}[./\-]\d{1,2}")
VENUE_KEYWORDS = [
    " at ", "＠", " @ ", " @", "@",
    "HALL", "ホール", "ZEPP", "Zepp", "KINGDOM",
    "アリーナ", "arena", "ARENA",
    "Rensa", "Hatch",
    "スタジオ", "STUDIO",
]
YORIMICHI_KEYWORDS = [
    "よりみち", "ヨリミチ",
    "企画", "企劃",
    "テレビ", "TV番組", "テレ朝", "フジテレビ",
    "対談", "トーク", "TALK",
    "スペシャル映像", "special",
]


def classify_one(short: dict) -> dict:
    title = short.get("title") or ""
    tags = extract_hashtags(title)
    non_noise = [t for t in tags if normalize(t) not in NOISE_TAGS]

    # 1a. Song-name hashtag match (direct)
    matched_song = match_song_tag(tags)
    if matched_song:
        return {"bucket": "song_hashtag", "song": matched_song, "tags": tags, "match_via": "hashtag"}

    # 1b. Song name appears in title text (not hashtag) — e.g. "Twinkle Little Star #にしな..."
    matched_text = match_song_in_text(title)
    if matched_text:
        return {"bucket": "song_hashtag", "song": matched_text, "tags": tags, "match_via": "title_text"}

    # 3. Concert date announcement (check before よりみち since dates are strong signal)
    if DATE_RE.search(title) and any(k.lower() in title.lower() for k in VENUE_KEYWORDS):
        return {"bucket": "concert_announce", "song": None, "tags": tags}
    # even without venue keyword, date + "公演" or "LIVE" is a strong signal
    if DATE_RE.search(title) and re.search(r"(公演|LIVE|ライブ|ツアー|tour)", title, re.I):
        return {"bucket": "concert_announce", "song": None, "tags": tags}

    # 4. Yorimichi / planning
    if any(k in title for k in YORIMICHI_KEYWORDS):
        return {"bucket": "planning", "song": None, "tags": tags}

    # 2. Fallback — lyric-line only (no song hashtag, no date/venue, no planning)
    return {"bucket": "lyric_only", "song": None, "tags": tags}


def main():
    with open(IN_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    for s in data["shorts"]:
        c = classify_one(s)
        s["classification"] = c

    # Bucket stats
    from collections import Counter
    buckets = Counter(s["classification"]["bucket"] for s in data["shorts"])
    song_counts = Counter(
        s["classification"]["song"]
        for s in data["shorts"]
        if s["classification"]["bucket"] == "song_hashtag"
    )

    data["meta"]["classification"] = {
        "buckets": dict(buckets),
        "song_hashtag_counts": dict(song_counts.most_common()),
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total = len(data["shorts"])
    print(f"\n=== Classification results ({total} shorts total) ===\n")
    labels = {
        "song_hashtag":     "1. 有歌名 hashtag ",
        "lyric_only":       "2. 只有歌詞句     ",
        "concert_announce": "3. 公演日期宣傳   ",
        "planning":         "4. よりみち / 企劃",
    }
    for key, label in labels.items():
        n = buckets.get(key, 0)
        pct = 100 * n / total if total else 0
        print(f"  {label}  {n:>4}  ({pct:5.1f}%)")

    print(f"\n=== Top 20 songs by short count ===\n")
    for song, n in song_counts.most_common(20):
        print(f"  {n:>3}  {song}")

    print(f"\n✓ Written: {OUT_FILE}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
