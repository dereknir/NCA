#!/usr/bin/env python3
"""
build_pixel_fonts.py — 站台像素字型子集管線

data/site_charset.txt (build_site_charset.py 產出)
  → public/fonts/pixel/fp12-site-{zh_hant,ja}.woff2

來源字型 fusion-pixel 12px proportional (OFL-1.1), 版本 pin 在下方 RELEASE。
完整 TTF (~7MB×2) 不進 repo — 本腳本第一次跑會下載到 fonts_src/ (gitignored),
之後重跑直接用快取。字集有變 (新歌名/新頁面) 才需要重跑:

    python scripts/build_site_charset.py && python scripts/build_pixel_fonts.py

依賴: pip install fonttools brotli
"""
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC_DIR = ROOT / "fonts_src"
OUT_DIR = ROOT / "public" / "fonts" / "pixel"
CHARSET = ROOT / "data" / "site_charset.txt"

RELEASE = "2026.07.20"   # pin 版本; 升版時改這裡重跑
ZIP_URL = (f"https://github.com/TakWolf/fusion-pixel-font/releases/download/"
           f"{RELEASE}/fusion-pixel-font-12px-proportional-ttf-v{RELEASE}.zip")
LANGS = ["zh_hant", "ja"]


def ensure_sources():
    missing = [l for l in LANGS
               if not (SRC_DIR / f"fusion-pixel-12px-proportional-{l}.ttf").exists()]
    if not missing:
        return
    SRC_DIR.mkdir(exist_ok=True)
    zip_path = SRC_DIR / "fusion-pixel-12px.zip"
    print(f"↓ 下載 fusion-pixel {RELEASE} (~34MB, 只需一次) …")
    urllib.request.urlretrieve(ZIP_URL, zip_path)
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if name.endswith(".ttf") and any(f"-{l}.ttf" in name for l in LANGS):
                z.extract(name, SRC_DIR)
                print(f"  ✓ {name}")
        for name in z.namelist():
            if "OFL" in name and "ark-pixel" in name:
                data = z.read(name)
                (OUT_DIR).mkdir(parents=True, exist_ok=True)
                (OUT_DIR / "OFL.txt").write_bytes(data)
                break
    zip_path.unlink()


def subset(lang: str):
    from fontTools import subset as fts
    src = SRC_DIR / f"fusion-pixel-12px-proportional-{lang}.ttf"
    out = OUT_DIR / f"fp12-site-{lang}.woff2"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        str(src),
        f"--text-file={CHARSET}",
        "--flavor=woff2",
        f"--output-file={out}",
    ]
    fts.main(args)
    print(f"✓ {out.relative_to(ROOT)} ({out.stat().st_size // 1024}KB)")


def main():
    if not CHARSET.exists():
        print("先跑 scripts/build_site_charset.py", file=sys.stderr)
        sys.exit(1)
    ensure_sources()
    for lang in LANGS:
        subset(lang)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
