"""
scrape_setlists.py — 抓 にしな 巡演 setlist 資料

流程:
  1. Fetch Linkfire hub https://nishina.lnk.to/live_setlist
     → 每一巡演: title / 日期 / Spotify + Apple Music playlist URL
  2. 每個 Spotify playlist → embed 頁 (https://open.spotify.com/embed/playlist/ID)
     → 內含 __NEXT_DATA__ JSON, 抽 trackList
  3. Track title 用 rapidfuzz 對現有翻譯庫 (src/data/lyrics.json) 做 fuzzy match
  4. 輸出 src/data/setlists.json 給 setlists 頁讀

不需要 Spotify API auth ; embed 頁公開存取。
出處全指回官方 Linkfire hub, setlist 為事實資料。
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from datetime import datetime, timezone, timedelta

try:
    from rapidfuzz import fuzz
except ImportError:
    sys.exit("需要 rapidfuzz: pip install rapidfuzz")

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent
# lyrics.json 由 scripts/export_lyrics_json.py 產出到 data/ (canonical);
# 舊版本曾誤讀 src/data/lyrics.json (那份會 stale, 因為只有 pipeline 寫的路徑會 refresh)
LYRICS_JSON = ROOT / 'data' / 'lyrics.json'
OUT_JSON = ROOT / 'src' / 'data' / 'setlists.json'
COVERS_DIR = ROOT / 'public' / 'setlists' / 'covers'
HUB_URL = 'https://nishina.lnk.to/live_setlist'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0'


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', errors='replace')


def fetch_bytes(url: str) -> tuple:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(), r.headers.get('Content-Type', '')


def decode_unicode_escape(s: str) -> str:
    """Linkfire 頁的 JSON 字串已含 \\uXXXX 逃逸,decode 一次"""
    try:
        return s.encode('utf-8').decode('unicode_escape')
    except UnicodeDecodeError:
        return s


def parse_hub(html: str) -> list:
    """從 Linkfire hub HTML 抽 10 場 tour + 各自 Spotify/Apple URL."""
    positions = [m.start() for m in re.finditer(
        r'"section":"landingpage","title":"[^"]+"', html)]
    positions.append(len(html))
    tours = []
    for i in range(len(positions) - 1):
        block = html[positions[i]:positions[i + 1]]
        t = re.search(r'"title":"([^"]+)"', block)
        s = re.search(r'"subTitle":"([^"]*)"', block)
        title = decode_unicode_escape(t.group(1)) if t else '?'
        date = decode_unicode_escape(s.group(1)) if s else ''
        urls = re.findall(
            r'"serviceName":"(spotify|applemusic)"[^}]*?"url":"([^"]+)"',
            block, re.DOTALL)

        def clean(u: str) -> str:
            u = decode_unicode_escape(u).replace('\\/', '/')
            return u.split('?')[0]
        sp = next((clean(u) for s2, u in urls if s2 == 'spotify'), None)
        ap = next((clean(u) for s2, u in urls if s2 == 'applemusic'), None)
        if not sp:
            continue
        tours.append({'title': title, 'date': date,
                     'spotify': sp, 'applemusic': ap})
    return tours


def parse_spotify_embed(playlist_url: str) -> dict:
    """從 Spotify embed 頁抽 tracklist + 封面 URL. 無 auth."""
    pid = playlist_url.rstrip('/').split('/')[-1]
    embed_url = f'https://open.spotify.com/embed/playlist/{pid}'
    html = fetch(embed_url)
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>',
        html, re.DOTALL)
    if not m:
        return {'tracks': [], 'cover_url': None, 'playlist_id': pid}
    try:
        data = json.loads(m.group(1))
    except Exception as e:
        print(f'  ⚠ JSON parse err: {e}', file=sys.stderr)
        return {'tracks': [], 'cover_url': None, 'playlist_id': pid}

    def find_entity(obj):
        """Return the 'entity' dict containing trackList + coverArt."""
        if isinstance(obj, dict):
            if 'trackList' in obj and isinstance(obj['trackList'], list):
                return obj
            for v in obj.values():
                r = find_entity(v)
                if r is not None:
                    return r
        elif isinstance(obj, list):
            for v in obj:
                r = find_entity(v)
                if r is not None:
                    return r
        return None

    entity = find_entity(data) or {}
    raw = entity.get('trackList', [])
    tracks = []
    for i, t in enumerate(raw):
        tracks.append({
            'index': i + 1,
            'title': t.get('title', ''),
            'artist': t.get('subtitle', ''),
            'uid': t.get('uid', ''),
        })
    # coverArt.sources 通常有多 size, 取第一個 (masterpiece / 最大)
    cover_url = None
    cover_art = entity.get('coverArt') or {}
    sources = cover_art.get('sources') or []
    if sources:
        cover_url = sources[0].get('url')
    return {'tracks': tracks, 'cover_url': cover_url, 'playlist_id': pid}


def download_cover(url: str, playlist_id: str) -> str | None:
    """Download cover to public/setlists/covers/<pid>.<ext>. Return public path or None."""
    if not url:
        return None
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        buf, ctype = fetch_bytes(url)
    except Exception as e:
        print(f'  ⚠ cover fetch err: {e}', file=sys.stderr)
        return None
    ext = 'webp' if 'webp' in ctype else 'jpg' if 'jpeg' in ctype or 'jpg' in ctype else 'png' if 'png' in ctype else 'img'
    dest = COVERS_DIR / f'{playlist_id}.{ext}'
    dest.write_bytes(buf)
    return f'/setlists/covers/{dest.name}'


def load_translation_songs() -> list:
    """讀本站現有翻譯的にしな 歌單, 供 fuzzy match 用."""
    d = json.load(open(LYRICS_JSON, encoding='utf-8'))
    return [
        {'id': s['id'], 'title': s['title']}
        for s in d['songs'] if s['id'].startswith('nishina-')
    ]


def norm(s: str) -> str:
    """降低 fuzzy match 的 noise:去空白、去分隔符."""
    return re.sub(r'[\s・\-—〜~]+', '', s or '').lower()


def match_track(track_title: str, translations: list) -> tuple:
    """Return (song_id, score) or (None, 0) if no good match."""
    nt = norm(track_title)
    if not nt:
        return (None, 0)
    best_id, best_score = None, 0
    for s in translations:
        # exact-normalized match 直接 100
        ns = norm(s['title'])
        if nt == ns:
            return (s['id'], 100)
        score = max(
            fuzz.ratio(nt, ns),
            fuzz.partial_ratio(nt, ns),
        )
        if score > best_score:
            best_score, best_id = score, s['id']
    # 門檻 82 (低於就當作沒對到)
    return (best_id, best_score) if best_score >= 82 else (None, best_score)


def main():
    print('[setlists] fetching Linkfire hub...')
    hub_html = fetch(HUB_URL)
    tours = parse_hub(hub_html)
    print(f'[setlists] parsed {len(tours)} tours')

    translations = load_translation_songs()
    print(f'[setlists] {len(translations)} nishina translations available')

    for i, t in enumerate(tours):
        print(f'\n[{i+1}/{len(tours)}] {t["title"]} ({t["date"]})')
        try:
            info = parse_spotify_embed(t['spotify'])
        except Exception as e:
            print(f'  ⚠ fetch err: {e}')
            info = {'tracks': [], 'cover_url': None, 'playlist_id': ''}
        tracks = info['tracks']
        # match each track to translation
        matched = 0
        for tr in tracks:
            sid, score = match_track(tr['title'], translations)
            tr['matched_song_id'] = sid
            tr['match_score'] = score
            if sid:
                matched += 1
        t['tracks'] = tracks
        t['track_count'] = len(tracks)
        t['matched_count'] = matched
        # 下載封面到 public/, 存 site-relative path
        t['cover'] = download_cover(info['cover_url'], info['playlist_id']) if info['cover_url'] else None
        cover_note = f' + cover' if t['cover'] else ''
        print(f'  → {len(tracks)} tracks, {matched} matched{cover_note}')
        # 手軟一點, 別打太快
        time.sleep(0.5)

    tpe = timezone(timedelta(hours=8))
    now_iso = datetime.now(tpe).isoformat(timespec='seconds')
    meta = {
        'generated': now_iso,
        'source': HUB_URL,
        'tour_count': len(tours),
        'total_tracks': sum(t.get('track_count', 0) for t in tours),
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'tours': tours}, f, ensure_ascii=False, indent=2)

    print(f'\n[setlists] wrote {OUT_JSON}')
    print(f'  {len(tours)} tours, {meta["total_tracks"]} total track entries')


if __name__ == '__main__':
    main()
