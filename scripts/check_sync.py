#!/usr/bin/env python3
"""
check_sync.py — 驗證「有鏡像副本」的衍生資料檔兩邊一致 (CI 跑, 本地也能跑)

站上 /annotate/ 的標注工具只能讀 public/ 下的檔案, 所以幾份資料在 repo 裡有兩份:
來源由各腳本產出, 並由同一支腳本直接鏡像到 public/annotate/。這支腳本不產生任何東西,
只檢查每一對是否 byte-for-byte 相同 — 有人手動只改了一邊、或新增了鏡像卻忘了接
腳本, 在這裡會立刻炸, 而不是等標注工具安靜地讀到舊資料。

用法: python scripts/check_sync.py      (exit 0 = 全部一致)
"""
import filecmp
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
    if bad:
        print(f'\n{bad} 對鏡像有問題', file=sys.stderr)
        return 1
    print('\n全部鏡像一致')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
