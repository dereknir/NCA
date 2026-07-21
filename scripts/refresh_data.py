#!/usr/bin/env python3
"""
refresh_data.py — 一鍵重跑歌詞資料 pipeline

順序:
  1. export_lyrics_json.py   md 檔 → data/lyrics.json
  2. analyze_lyrics.py       lyrics.json → src/data/lyric_universe.json + public/lyric-universe/index.html

用法 (從 repo root):
  python scripts/refresh_data.py

當你新增 / 修改任一首歌的 md, 跑這個就等於全站分析資料同步完畢。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

STEPS = [
    ('scripts/export_lyrics_json.py', 'md → data/lyrics.json'),
    ('scripts/analyze_lyrics.py',     'lyrics.json → lyric_universe (JSON + HTML)'),
    ('scripts/build_kwic.py',         'lyrics.json → kwic_index (JSON + HTML)'),
]

for script, desc in STEPS:
    print(f'\n▶ {desc}')
    print(f'  ({script})')
    result = subprocess.run([sys.executable, script], cwd=ROOT)
    if result.returncode != 0:
        print(f'\n! 失敗於 {script}, 中止 pipeline')
        sys.exit(result.returncode)

print('\n✓ 全部完成 — dev server 若在跑,重新整理 /lyric-universe/ 即可看到最新分析')
