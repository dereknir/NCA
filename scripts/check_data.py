#!/usr/bin/env python3
"""
check_data.py — 主要資料檔的結構檢查 (不加任何依賴, CI 經由 check_sync.py 跑)

排程每天會自動改這些檔, annotator 也會直接 commit; 格式一旦壞掉 (少欄位、id 重複、
時間點指到不存在的歌詞行), build 不一定會炸, 但頁面會安靜地顯示錯的東西。
這裡只檢查「一定要成立」的結構, 不檢查內容好不好; 只讀不寫。

檢查:
  data/lyrics.json              歌 id 唯一、歌詞行 index 連續 (跟 translations/*.md 對不上只警告)
  data/nishina_shorts.json      shorts id 是 YouTube id、不重複
  src/data/setlists.json        meta 的巡演數 / 曲數對得上、曲序連續、對到的歌 id 存在 (date 只檢查是字串)
  src/data/full_live.json       歌 id 存在、有歌詞行
  src/data/shorts_by_song.json  歌 id 存在、videoId 合法
  annotation/shorts_anchors.json  status 合法、songId 存在 (或 __ 開頭的花絮分類)、
                                  時間點 ≥0 且指到存在的歌詞行
  src/content/translations/*.md 的 tags  只用 src/data/song_tags.json 列的詞 (曲風 / 主題 / 合作與出處);
                                  主題每首 1~3 個 (純音樂可以沒有)、每個主題至少 2 首

用法: python scripts/check_data.py      (exit 0 = 全部通過)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
YT_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
SONG_ID = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
STATUSES = {'done', 'auto', 'pending', 'skip'}


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []   # 印出來但不讓 CI 失敗

    def check(self, ok: bool, msg: str) -> bool:
        if not ok:
            self.errors.append(msg)
        return ok


def load(rel: str):
    return json.loads((ROOT / rel).read_text(encoding='utf-8'))


def check_lyrics(r: Report) -> dict[str, int]:
    """回傳 {歌 id: 歌詞行數}, 給後面的檢查用"""
    f = 'data/lyrics.json'
    d = load(f)
    songs = d.get('songs')
    if not r.check(isinstance(songs, list), f'{f}: 沒有 songs 陣列'):
        return {}
    lines: dict[str, int] = {}
    for s in songs:
        sid = s.get('id')
        r.check(isinstance(sid, str) and bool(SONG_ID.match(sid)), f'{f}: 歌 id 格式不對: {sid!r}')
        r.check(sid not in lines, f'{f}: 歌 id 重複: {sid}')
        r.check(isinstance(s.get('title'), str) and s['title'] != '', f'{f}: {sid} 沒有 title')
        ll = s.get('lyric_lines')
        if not r.check(isinstance(ll, list), f'{f}: {sid} 沒有 lyric_lines'):
            continue
        idx = [x.get('index') for x in ll]
        r.check(idx == list(range(len(ll))), f'{f}: {sid} 的歌詞行 index 不是 0..{len(ll) - 1} 連續')
        r.check(all(isinstance(x.get('ja'), str) for x in ll), f'{f}: {sid} 有歌詞行缺 ja')
        lines[sid] = len(ll)
    # 只 push md 時, lyrics.json 由 refresh-lyric-data 排程隨後重產 → 這裡只提醒, 不擋
    md = {p.stem for p in (ROOT / 'src/content/translations').glob('*.md')}
    for sid in sorted(md - set(lines)):
        r.warnings.append(f'{f}: 少了 {sid} (有 md 但還沒匯出; 排程會補, 或本機跑 scripts/export_lyrics_json.py)')
    for sid in sorted(set(lines) - md):
        r.warnings.append(f'{f}: 多了 {sid} (md 已經不在; 排程會補, 或本機跑 scripts/export_lyrics_json.py)')
    return lines


def check_shorts(r: Report) -> set[str]:
    f = 'data/nishina_shorts.json'
    d = load(f)
    shorts = d.get('shorts')
    if not r.check(isinstance(shorts, list) and len(shorts) > 0, f'{f}: shorts 是空的或不是陣列'):
        return set()
    seen: set[str] = set()
    for s in shorts:
        vid = s.get('id')
        if not r.check(isinstance(vid, str) and bool(YT_ID.match(vid)), f'{f}: 不合法的 id: {vid!r}'):
            continue
        r.check(vid not in seen, f'{f}: id 重複: {vid}')
        r.check(isinstance(s.get('title'), str), f'{f}: {vid} 沒有 title')
        r.check(vid in str(s.get('url', '')), f'{f}: {vid} 的 url 對不上 id')
        seen.add(vid)
    return seen


def check_setlists(r: Report, songs: dict[str, int]):
    f = 'src/data/setlists.json'
    d = load(f)
    tours, meta = d.get('tours', []), d.get('meta', {})
    r.check(meta.get('tour_count') == len(tours), f'{f}: meta.tour_count={meta.get("tour_count")} 但有 {len(tours)} 個巡演')
    total = sum(len(t.get('tracks', [])) for t in tours)
    r.check(meta.get('total_tracks') == total, f'{f}: meta.total_tracks={meta.get("total_tracks")} 但實際 {total} 首')
    for t in tours:
        name = t.get('title', '?')
        r.check(isinstance(t.get('date'), str), f'{f}: {name} 的 date 不是字串')   # 內容照官方頁, 可能是空的, 不檢查格式
        tracks = t.get('tracks', [])
        r.check([x.get('index') for x in tracks] == list(range(1, len(tracks) + 1)), f'{f}: {name} 的曲序不是 1..{len(tracks)} 連續')
        for x in tracks:
            m = x.get('matched_song_id')
            r.check(m is None or m in songs, f'{f}: {name} 第 {x.get("index")} 首對到不存在的歌: {m}')


def check_full_live(r: Report, songs: dict[str, int]):
    f = 'src/data/full_live.json'
    d = load(f)
    seen: set[str] = set()
    for s in d.get('songs', []):
        sid = s.get('id')
        r.check(sid in songs, f'{f}: 不存在的歌: {sid}')
        r.check(sid not in seen, f'{f}: 歌重複: {sid}')
        r.check(isinstance(s.get('lines'), list) and len(s['lines']) > 0, f'{f}: {sid} 沒有歌詞行')
        r.check(isinstance(s.get('shorts'), list), f'{f}: {sid} 沒有 shorts 陣列')
        seen.add(sid)


def check_shorts_by_song(r: Report, songs: dict[str, int]):
    f = 'src/data/shorts_by_song.json'
    d = load(f)
    for sid, items in d.get('by_song', {}).items():
        r.check(sid in songs, f'{f}: 不存在的歌: {sid}')
        for it in items:
            vid = it.get('videoId')
            r.check(isinstance(vid, str) and bool(YT_ID.match(vid)), f'{f}: {sid} 有不合法的 videoId: {vid!r}')


def check_anchors(r: Report, songs: dict[str, int]):
    f = 'annotation/shorts_anchors.json'
    d = load(f)
    if not r.check(isinstance(d, dict), f'{f}: 應該是 {{videoId: 標注}} 物件'):
        return
    for vid, a in d.items():
        r.check(bool(YT_ID.match(vid)), f'{f}: 不合法的 videoId: {vid!r}')
        r.check(a.get('status') in STATUSES, f'{f}: {vid} 的 status 不認得: {a.get("status")!r}')
        sid = a.get('songId')
        known = sid is None or sid in songs or (isinstance(sid, str) and sid.startswith('__'))
        r.check(known, f'{f}: {vid} 的 songId 不存在: {sid}')
        anchors = a.get('anchors') or []
        r.check(isinstance(anchors, list), f'{f}: {vid} 的 anchors 不是陣列')
        n = songs.get(sid) if isinstance(sid, str) else None
        for x in anchors if isinstance(anchors, list) else []:
            t, line = x.get('t'), x.get('line')
            r.check(isinstance(t, (int, float)) and t >= 0, f'{f}: {vid} 有時間點 t 不合法: {t!r}')
            r.check(isinstance(line, int) and line >= 0, f'{f}: {vid} 有 line 不合法: {line!r}')
            if n is not None and isinstance(line, int):
                r.check(line < n, f'{f}: {vid} 指到第 {line} 行, 但 {sid} 只有 {n} 行')


TAGS_LINE = re.compile(r'^tags:\s*(\[.*\])\s*$', re.M)
INSTRUMENTAL = re.compile(r'^instrumental:\s*true\s*$', re.M)


def check_song_tags(r: Report) -> dict[str, list[str]]:
    """回傳 {主題: [歌 id]}; 標籤寫在 md frontmatter 的一行 JSON 陣列"""
    f = 'src/data/song_tags.json'
    tax = load(f)
    themes = [t['name'] for t in tax['themes']]
    known = {g['name'] for g in tax['genres']} | set(themes) | set(tax['credits'])
    r.check(len(themes) == 18 and len(set(themes)) == 18, f'{f}: 主題要剛好 18 個不重複, 現在 {len(themes)} 個')
    slugs = [t['slug'] for t in tax['themes']] + [g['slug'] for g in tax['genres']]
    r.check(len(slugs) == len(set(slugs)) and all(SONG_ID.match(x) for x in slugs), f'{f}: slug 重複或格式不對')
    by_theme: dict[str, list[str]] = {t: [] for t in themes}
    for p in sorted((ROOT / 'src/content/translations').glob('*.md')):
        head = p.read_text(encoding='utf-8').split('---', 2)[1]
        m = TAGS_LINE.search(head)
        if not r.check(bool(m), f'{p.name}: 找不到一行的 tags: [...]'):
            continue
        tags = json.loads(m.group(1))
        for t in tags:
            r.check(t in known, f'{p.name}: 標籤「{t}」不在 {f} 裡 (新的合作對象請先加進 credits)')
        r.check(len(tags) == len(set(tags)), f'{p.name}: 標籤重複')
        mine = [t for t in tags if t in by_theme]
        lo = 0 if INSTRUMENTAL.search(head) else 1
        r.check(lo <= len(mine) <= 3, f'{p.name}: 主題要 {lo}~3 個, 現在 {len(mine)} 個 {mine}')
        for t in mine:
            by_theme[t].append(p.stem)
    for t, ids in by_theme.items():
        r.check(len(ids) >= 2, f'{f}: 主題「{t}」只有 {len(ids)} 首, 至少要 2 首')
    return by_theme


def main() -> int:
    r = Report()
    songs = check_lyrics(r)
    shorts = check_shorts(r)
    check_setlists(r, songs)
    check_full_live(r, songs)
    check_shorts_by_song(r, songs)
    check_anchors(r, songs)
    themes = check_song_tags(r)
    for w in r.warnings:
        print(f'⚠ {w}')
    if r.errors:
        shown = r.errors[:50]
        for e in shown:
            print(f'✗ {e}')
        if len(r.errors) > len(shown):
            print(f'… 還有 {len(r.errors) - len(shown)} 個')
        print(f'\n資料檢查: {len(r.errors)} 個問題', file=sys.stderr)
        return 1
    print(f'✓ 資料結構檢查通過 ({len(songs)} 首歌、{len(shorts)} 支 shorts、{len(themes)} 個主題標籤)')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
