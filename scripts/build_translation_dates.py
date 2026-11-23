#!/usr/bin/env python3
"""
build_translation_dates.py — 每首翻譯是哪天翻好的、最後一次修改是哪天 (從 git 紀錄算)

翻譯檔裡的 publishDate 是歌的發行日, 不是翻譯完成那天; RSS 的「新翻譯」、之後的修改紀錄都要用真正的日期。
Vercel 只抓最近幾個 commit, 建站時沒辦法自己翻 git 紀錄, 所以在本機算好存成 JSON 一起進 repo。

translated = 第一個「檔案裡已經沒有『翻譯準備中』」的 commit (純音樂的歌: 第一次出現就算)
updated    = 最後一個動到這個檔的 commit

Writes: src/data/translation_dates.json   { "<id>": { "translated": ISO 時間 | null, "updated": ISO 時間 } }
用法:   python3 scripts/build_translation_dates.py   (新增 / 改了翻譯之後跑一次)
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src' / 'content' / 'translations'
OUT = ROOT / 'src' / 'data' / 'translation_dates.json'


def git(*args: str) -> str:
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def dates_for(path: Path) -> dict:
    rel = path.relative_to(ROOT).as_posix()
    # 由舊到新, --follow 才追得到改過檔名的
    log = git('log', '--follow', '--reverse', '--format=%H %cI', '--', rel).split('\n')
    commits = [line.split(' ', 1) for line in log if line.strip()]
    translated = None
    for sha, when in commits:
        try:
            body = git('show', f'{sha}:{rel}')
        except subprocess.CalledProcessError:
            continue   # 那時候還叫別的名字
        instrumental = re.search(r'^instrumental:\s*true\s*$', body, re.M)
        if instrumental or '翻譯準備中' not in body:
            translated = when
            break
    return {'translated': translated, 'updated': commits[-1][1] if commits else None}


def main() -> None:
    out = {}
    for path in sorted(SRC.glob('*.md*')):
        out[path.stem] = dates_for(path)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    done = sum(1 for v in out.values() if v['translated'])
    print(f'✓ {len(out)} 首 ({done} 首已翻好) → {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
