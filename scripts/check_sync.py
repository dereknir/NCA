#!/usr/bin/env python3
"""
check_sync.py — 驗證「有鏡像副本」的衍生資料檔兩邊一致 (CI 跑, 本地也能跑)

站上 /annotate/ 的標注工具只能讀 public/ 下的檔案, 所以幾份資料在 repo 裡有兩份:
來源由各腳本產出, 並由同一支腳本直接鏡像到 public/annotate/。這支腳本不產生任何東西,
只檢查每一對是否 byte-for-byte 相同 — 有人手動只改了一邊、或新增了鏡像卻忘了接
腳本, 在這裡會立刻炸, 而不是等標注工具安靜地讀到舊資料。

也檢查 kwic / 歌詞宇宙 / 星圖這三個「範本 + 注入資料」的產出頁: 範本那部分要逐字一樣
(只改資料照舊不會紅)。最後順便跑 check_data.py (主要資料檔的結構檢查), 以及 live/inject.py --check
(live 三頁是範本 + 資料產生的, 手改產出檔的修正會被排程重產蓋掉), CI 只要跑這一支就都檢查到。

用法: python scripts/check_sync.py      (exit 0 = 全部一致且資料結構正確)
"""
import filecmp
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (來源, 鏡像, 負責鏡像的腳本)
PAIRS = [
    ('data/lyrics.json',                 'public/annotate/lyrics.json',           'scripts/export_lyrics_json.py'),
    ('src/data/setlists.json',           'public/annotate/setlists.json',         'scripts/scrape_setlists.py'),
    ('annotation/annotation_queue.json', 'public/annotate/annotation_queue.json', 'annotation/build_annotation_queue.py'),
    ('annotation/auto_anchors.json',     'public/annotate/auto_anchors.json',     'scripts/auto_annotate.py'),
]

# 範本 + 資料注入產生的靜態頁 (資料的 json 換掉 /*__DATA__*/null)。排程重產時會整頁用範本蓋掉,
# 所以修正一定要改在範本; 這裡檢查產出檔「範本那部分」逐字一樣, 注入的資料不比 (只要是合法 JSON)。
# (產出檔, 範本, 負責產生的腳本)
TEMPLATED = [
    ('public/kwic/index.html',           'scripts/kwic.template.html',           'scripts/build_kwic.py'),
    ('public/lyric-universe/index.html', 'scripts/lyric-universe.template.html', 'scripts/analyze_lyrics.py'),
    ('public/star-map/index.html',       'scripts/star-map.template.html',       'scripts/embed_star_map.py'),
]
PLACEHOLDER = '/*__DATA__*/null'


def check_templated(out, tpl):
    """產出檔去掉注入的資料後要跟範本逐字一樣; 有問題回傳原因, 沒問題回傳 None"""
    o, t = ROOT / out, ROOT / tpl
    if not o.exists() or not t.exists():
        return f'缺檔: {out if not o.exists() else tpl}'
    tpl_html = t.read_text(encoding='utf-8')
    if tpl_html.count(PLACEHOLDER) != 1:
        return f'{tpl} 的 {PLACEHOLDER} 不是剛好一個'
    head, tail = tpl_html.split(PLACEHOLDER)
    got = o.read_text(encoding='utf-8')
    if not (got.startswith(head) and got.endswith(tail) and len(got) >= len(head) + len(tail)):
        return '範本以外的部分跟範本不一樣 (手改了產出檔? 或改了範本沒重產)'
    data = got[len(head):len(got) - len(tail)]
    try:
        json.loads(data.replace('<\\/', '</'))
    except ValueError:
        return '注入的資料不是合法 JSON'
    return None


def main() -> int:
    bad = 0
    for src, mirror, owner in PAIRS:
        a, b = ROOT / src, ROOT / mirror
        if not a.exists() or not b.exists():
            missing = src if not a.exists() else mirror
            print(f'✗ 缺檔: {missing}  (由 {owner} 產生)')
            bad += 1
            continue
        if filecmp.cmp(a, b, shallow=False):
            print(f'✓ {src} == {mirror}')
        else:
            print(f'✗ 不一致: {src} ≠ {mirror}  → 重跑 {owner} (它會同時寫兩份)')
            bad += 1
    for out, tpl, owner in TEMPLATED:
        why = check_templated(out, tpl)
        if why:
            print(f'✗ {out}: {why}  → 修正改在 {tpl}, 再跑 {owner} 重產')
            bad += 1
        else:
            print(f'✓ {out} 跟範本一致')
    # live 三頁: 範本 + 資料重產要跟 repo 裡的產出一模一樣
    live = subprocess.run([sys.executable, str(ROOT / 'live' / 'inject.py'), '--check'],
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
    if live.returncode:
        print(live.stdout + live.stderr)
        bad += 1
    else:
        print('✓ live 產出檔都跟範本一致')

    if bad:
        print(f'\n{bad} 項有問題', file=sys.stderr)
    else:
        print('\n全部一致')

    sys.path.insert(0, str(ROOT / 'scripts'))
    import check_data
    data_rc = check_data.main()
    return 1 if bad or data_rc else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
