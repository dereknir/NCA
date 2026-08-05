#!/usr/bin/env python3
"""
build_site_charset.py — 掃出「像素字型會渲染到」的全站字集 → data/site_charset.txt

像素字型 (fusion-pixel 12px) 只鋪在 UI 外殼: 導航/標題/按鈕/badge/歌名。
歌詞內文/新聞標題等長文保留 Noto, 所以字集不需要收整份歌詞 — 但「歌名/專輯名」
會在像素標題出現, 要收。缺字的下場是 per-glyph fallback 混排, 很醜, 寧可多收。

掃描來源:
  src/config.ts                     導航/站名/文案
  src/pages/**/*.astro              頁面 UI 文字 (粗剝 tag/code, 過收無害)
  src/layouts/*.astro, src/components/**/*.astro
  src/content/translations/*.md     只取 frontmatter title/artist/album
  live/*.template.html              live 三頁的靜態 UI 文字
  public/pixel-lab/index.html       提案頁自身
外加保險:
  ASCII 可見區 + 全形標點 + 平假名/片假名全表 + 常用 UI 緩衝字
"""
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data" / "site_charset.txt"

BUFFER = (
    "日文歌翻譯歌詞宇宙索引星圖巡演花絮卡日記作品集關於我演出設定匯入匯出存到完成"
    "播放暫停略過參戰蓋章年表公演史足跡版本純演奏標註未匹配已同步錯誤重試載入中"
    "探索查看全部最新精選篇個場支件類站點擊選擇開始下一支歡迎來的空間生活程式"
    "抽選背包收藏機台轉蛋確認取消關閉刪除編輯儲存複製分享搜尋篩選排序統計"
)


def strip_markup(text: str, keep_script: bool = False) -> str:
    """keep_script=True 用於工具頁 (live/annotator): UI 字串藏在 JS 裡
    (縣名/按鈕文案), 像素字型會渲染到, 必須收進字集。over-collect 無害。"""
    if not keep_script:
        text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return text


def frontmatter_fields(md: str) -> str:
    m = re.match(r"^---\n([\s\S]*?)\n---", md)
    if not m:
        return ""
    picked = []
    for line in m.group(1).splitlines():
        if re.match(r"\s*(title|artist|album)\s*:", line):
            picked.append(line.split(":", 1)[1])
    return " ".join(picked)


def main():
    chars: set[str] = set()

    for pattern in ["src/pages/**/*.astro", "src/layouts/*.astro", "src/components/**/*.astro"]:
        for p in ROOT.glob(pattern):
            chars |= set(strip_markup(p.read_text(encoding="utf-8")))
    chars |= set((ROOT / "src" / "config.ts").read_text(encoding="utf-8"))

    for p in (ROOT / "src" / "content" / "translations").glob("*.md"):
        chars |= set(frontmatter_fields(p.read_text(encoding="utf-8")))

    for p in ROOT.glob("live/*.template.html"):
        chars |= set(strip_markup(p.read_text(encoding="utf-8"), keep_script=True))

    annot = ROOT / "public" / "annotate" / "index.html"
    if annot.exists():
        chars |= set(strip_markup(annot.read_text(encoding="utf-8"), keep_script=True))

    lab = ROOT / "public" / "pixel-lab" / "index.html"
    if lab.exists():
        chars |= set(strip_markup(lab.read_text(encoding="utf-8")))

    chars |= set(BUFFER)
    chars |= {chr(c) for c in range(0x20, 0x7F)}          # ASCII 可見
    chars |= {chr(c) for c in range(0x3040, 0x3100)}      # ひらがな+カタカナ
    chars |= set("　、。・ー「」『』〜！？（）：…※→←↑↓")

    chars = {c for c in chars if (not c.isspace() or c == "　") and c.isprintable()}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("".join(sorted(chars)), encoding="utf-8")
    print(f"✓ {OUT.relative_to(ROOT)} — {len(chars)} chars")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
