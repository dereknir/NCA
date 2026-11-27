#!/usr/bin/env python3
"""
build_pixel_fonts.py — 站台像素字型子集管線

data/site_charset.txt (build_site_charset.py 產出)
  → public/fonts/pixel/fp{12,10,8}-site-{zh_hant,ja}.woff2
  → public/fonts/openhuninn/oh-NN.woff2 (粉圓切片) + public/css/site-shell.css 裡的 @font-face
  → public/fonts/openhuninn/doc/<歌>.woff2 + doc/index.json (每首歌自己的粉圓字, 歌詞頁 inline 宣告)
  → public/fonts/dotgothic16/dg16-site.woff2 (日文歌詞行的 DotGothic16, 原本從 Google Fonts 載)

來源字型 fusion-pixel 12px proportional (OFL-1.1), 版本 pin 在下方 RELEASE。
完整 TTF (~7MB×2) 不進 repo — 本腳本第一次跑會下載到 fonts_src/ (gitignored),
之後重跑直接用快取。字集有變 (新歌名/新頁面) 才需要重跑:

    python scripts/build_site_charset.py && python scripts/build_pixel_fonts.py
    python scripts/build_pixel_fonts.py openhuninn     # 只重切粉圓 (像素字不動)
    python scripts/build_pixel_fonts.py dotgothic      # 只重切 DotGothic16

依賴: pip install fonttools brotli
"""
import io
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC_DIR = ROOT / "fonts_src"
OUT_DIR = ROOT / "public" / "fonts" / "pixel"
CHARSET = ROOT / "data" / "site_charset.txt"

RELEASE = "2026.07.20"   # pin 版本; 升版時改這裡重跑
LANGS = ["zh_hant", "ja"]
# 12px 網格 = UI/標題 (12/24/36); 10px 網格 = 內文 (20px, 全站像素統一 2026-08);
# 8px 網格 = ガチャ卡面小字 (public/gacha 的 JP8/TC8, 與全站共用同一份子集)
SIZES = [12, 10, 8]


def zip_url(size: int) -> str:
    return (f"https://github.com/TakWolf/fusion-pixel-font/releases/download/"
            f"{RELEASE}/fusion-pixel-font-{size}px-proportional-ttf-v{RELEASE}.zip")


def ensure_sources(size: int):
    missing = [l for l in LANGS
               if not (SRC_DIR / f"fusion-pixel-{size}px-proportional-{l}.ttf").exists()]
    if not missing:
        return
    SRC_DIR.mkdir(exist_ok=True)
    zip_path = SRC_DIR / f"fusion-pixel-{size}px.zip"
    print(f"↓ 下載 fusion-pixel {size}px {RELEASE} (~30MB, 只需一次) …")
    urllib.request.urlretrieve(zip_url(size), zip_path)
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


def subset(size: int, lang: str):
    from fontTools import subset as fts
    src = SRC_DIR / f"fusion-pixel-{size}px-proportional-{lang}.ttf"
    out = OUT_DIR / f"fp{size}-site-{lang}.woff2"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        str(src),
        f"--text-file={CHARSET}",
        "--flavor=woff2",
        f"--output-file={out}",
    ]
    fts.main(args)
    print(f"✓ {out.relative_to(ROOT)} ({out.stat().st_size // 1024}KB)")


def verify_coverage():
    """字集裡每個字都必須在子集 cmap — 缺字 = 內文會混排 fallback, 直接報錯。"""
    from fontTools.ttLib import TTFont
    text = CHARSET.read_text(encoding="utf-8")
    for size in SIZES:
        cov = set()
        for lang in LANGS:
            f = TTFont(OUT_DIR / f"fp{size}-site-{lang}.woff2")
            for t in f["cmap"].tables:
                cov |= set(t.cmap.keys())
        miss = [c for c in text if ord(c) > 0x7F and ord(c) not in cov and c.isprintable()]
        if miss:
            print(f"⚠ fp{size} 缺 {len(miss)} 字 (來源字型本身沒有): {''.join(sorted(set(miss))[:40])}",
                  file=sys.stderr)
        else:
            print(f"✓ fp{size} 覆蓋 100%")


OPENHUNINN_URL = "https://cdn.jsdelivr.net/gh/justfont/open-huninn-font@master/font/jf-openhuninn-2.1.ttf"


# 粉圓切片 (2026-11): 整份 ~590KB, 可是大部分頁面只有標題區那一句說明用粉圓 —
# 切成好幾片、每片標 unicode-range, 瀏覽器只抓這頁用得到的那幾片:
#   第 0 片 = 英數標點 + 全站標題區說明的字 + 很多首歌都用到的字 (一般頁面只要這片, 換頁吃快取)
#   中間    = 罕見字, 按「第一個用到它的那篇」分群 (同一首歌的罕見字擠在同幾片)
#   最後    = 剩下的 (頁面自己的文案等)
OH_DIR = ROOT / "public" / "fonts" / "openhuninn"
OH_CSS = ROOT / "public" / "css" / "site-shell.css"
OH_MARK = ("/* openhuninn 切片: scripts/build_pixel_fonts.py 產生, 別手改 */", "/* openhuninn 切片結束 */")
OH_COMMON = 15      # 至少幾篇內容用到 → 放第 0 片
OH_RARE = 5        # 少於幾篇用到 = 罕見字, 按篇分群; 介於中間的照常見程度排
OH_STEP = 150      # 之後每片幾個字


def _plain(text: str) -> str:
    text = re.sub(r"<(script|style)\b[\s\S]*?</\1>", " ", text, flags=re.I)
    return re.sub(r"<[^>]+>", " ", text)


def _ranges(cps: list[int]) -> str:
    cps = sorted(set(cps))
    out, start, prev = [], cps[0], cps[0]
    for cp in cps[1:] + [None]:
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        out.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
        if cp is not None:
            start = prev = cp
    return ", ".join(out)


def subset_openhuninn():
    """jf 粉圓 (H 拍板 2026-08): 中文閱讀區內文字 → public/fonts/openhuninn/oh-NN.woff2 + site-shell.css 的 @font-face"""
    from fontTools import subset as fts
    from fontTools.ttLib import TTFont
    src = SRC_DIR / "jf-openhuninn-2.1.ttf"
    if not src.exists():
        SRC_DIR.mkdir(exist_ok=True)
        print("↓ 下載 jf-openhuninn 2.1 (~4.7MB, 只需一次) …")
        urllib.request.urlretrieve(OPENHUNINN_URL, src)
    have = set(TTFont(src)["cmap"].getBestCmap())
    charset = sorted({c for c in CHARSET.read_text(encoding="utf-8") if ord(c) in have and c.isprintable()})

    # 每篇內容一份; 數每個字被幾篇用到。日記、作品排前面: 它們的罕見字集中在自己那幾片,
    # 不會散進各首歌的片裡 (不然看一篇日記要把每一片都抓下來)
    docs = []
    for coll in ["diary", "projects", "translations"]:
        for p in sorted((ROOT / "src" / "content" / coll).glob("*.md")):
            docs.append(set(_plain(p.read_text(encoding="utf-8"))))
    df = {c: sum(c in d for d in docs) for c in charset}
    # 標題區的一句說明: PageHero 的 desc="…"、靜態頁的 <p class="sh-desc">
    hero = set()
    for p in ROOT.glob("src/pages/**/*.astro"):
        for m in re.finditer(r'desc=(?:"([^"]*)"|\{`([^`]*)`\})', p.read_text(encoding="utf-8")):
            hero |= set(m.group(1) or m.group(2) or "")
    for p in list(ROOT.glob("public/*/index.html")) + list(ROOT.glob("public/live/*/index.html")):
        for m in re.finditer(r'class="sh-desc"[^>]*>([\s\S]*?)</p>', p.read_text(encoding="utf-8")):
            hero |= set(_plain(m.group(1)))

    head = [c for c in charset if ord(c) < 0x3000 or c in hero or df[c] >= OH_COMMON or 0xFF00 <= ord(c) <= 0xFF65]
    head_set = set(head)
    # 中間層: 好幾篇都會用到的字, 照常見程度排 (一首歌會用到的大多集中在前幾片)
    mid = sorted((c for c in charset if c not in head_set and df[c] >= OH_RARE), key=lambda c: (-df[c], ord(c)))
    # 罕見字: 按「第一個用到它的那篇」分群, 同一篇的擠在同幾片
    first_doc = lambda c: next((i for i, d in enumerate(docs) if c in d), len(docs))
    rare = sorted((c for c in charset if c not in head_set and df[c] < OH_RARE), key=lambda c: (first_doc(c), ord(c)))
    chunk = lambda xs: [xs[i:i + OH_STEP] for i in range(0, len(xs), OH_STEP)]
    slices = [head] + chunk(mid) + chunk(rare)

    OH_DIR.mkdir(parents=True, exist_ok=True)
    for old in OH_DIR.glob("oh-*.woff2"):
        old.unlink()
    faces, total = [], 0
    for i, chars in enumerate(slices):
        out = OH_DIR / f"oh-{i:02d}.woff2"
        txt = OH_DIR / ".slice.txt"
        txt.write_text("".join(chars), encoding="utf-8")
        fts.main([str(src), f"--text-file={txt}", "--flavor=woff2", f"--output-file={out}"])
        txt.unlink()
        total += out.stat().st_size
        faces.append(f"@font-face {{ font-family: 'openhuninn'; src: url('/fonts/openhuninn/oh-{i:02d}.woff2') format('woff2'); "
                     f"font-display: swap; unicode-range: {_ranges([ord(c) for c in chars])}; }}")
    print(f"✓ public/fonts/openhuninn/ {len(slices)} 片, 第 0 片 {len(head)} 字 "
          f"{(OH_DIR / 'oh-00.woff2').stat().st_size // 1024}KB, 全部 {total // 1024}KB")

    css = OH_CSS.read_text(encoding="utf-8")
    a, b = css.index(OH_MARK[0]), css.index(OH_MARK[1])
    OH_CSS.write_text(css[:a] + OH_MARK[0] + "\n" + "\n".join(faces) + "\n" + css[b:], encoding="utf-8")
    print(f"✓ {OH_CSS.relative_to(ROOT)} 的 @font-face 已更新")

    subset_openhuninn_songs(src, head_set, set(charset))


# 每首歌一個小檔 (N17, 2026-11): 歌詞頁的罕見字散在十幾片裡, 一頁要抓 ~525KB。
# 改成每首歌多一個自己的檔 = 這首歌用到、但第 0 片沒有的字。歌詞頁 inline 宣告它 (同一個 'openhuninn',
# 宣告在 site-shell.css 後面 → 這些字先用這個檔); 沒收到的字照舊從共用切片補, 不會缺字。
#   public/fonts/openhuninn/doc/<歌>.woff2
#   public/fonts/openhuninn/doc/index.json  {"<md 檔名>": {"f": "<歌>.woff2", "c": "這個檔收的字"}}
# 新增一首歌只多一個 woff2 (index.json 是改, 不是新增)。第 0 片的字變了每首都要重切, 一起重產生。
OH_DOC_DIR = OH_DIR / "doc"
# 每首歌頁都有、但不在 md 裡的粉圓字: 現場履歷 (SongLiveHistory) 的固定文案 + 巡演名稱。
# 量過 50 首, 不收的話每頁還會為了這幾個字多抓 1~3 片共用切片。
OH_SONG_PAGE = [ROOT / "src" / "components" / "SongLiveHistory.astro"]
OH_SONG_TOURS = ROOT / "src" / "data" / "setlists.json"
# 日文行 / 羅馬拼音行是 DotGothic16 (global.css .lyrics-line .ja / .romaji), 不會用到粉圓 → 不收
OH_NOT_READ = re.compile(r'<div class="(?:ja|romaji)">[\s\S]*?</div>')


def _doc_file(key: str) -> str:
    """md 檔名 → 檔名; 只有英數 ._- 的照用, 其他字 (空白、中日文…) 換掉再加短 hash 避免撞名"""
    import hashlib
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", key).strip("-.") or "song"
    if safe != key:
        safe += "-" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
    return safe + ".woff2"


def subset_openhuninn_songs(src: Path, head_set: set, sliced: set):
    """只收共用切片裡有的字 (= 站台字集 ∩ 粉圓): 切片沒有的字 (例如空白) 本來就走後備字型, 收進來畫面會變"""
    import json
    from fontTools import subset as fts
    base = ROOT / "src" / "content" / "translations"
    OH_DOC_DIR.mkdir(parents=True, exist_ok=True)
    # md 轉 HTML 時 smartypants 會把 ' " -- ... 換成彎引號、破折號、刪節號 (md 原文裡看不到)
    page = "‘’“”–—…" + "".join(_plain(p.read_text(encoding="utf-8")) for p in OH_SONG_PAGE if p.exists())
    if OH_SONG_TOURS.exists():
        page += " ".join(t.get("title", "") for t in json.loads(OH_SONG_TOURS.read_text(encoding="utf-8")).get("tours", []))
    index, total = {}, 0
    for p in sorted(base.rglob("*.md*")):
        if p.suffix not in (".md", ".mdx"):
            continue
        key = p.relative_to(base).with_suffix("").as_posix()
        text = OH_NOT_READ.sub(" ", p.read_text(encoding="utf-8"))
        chars = sorted({c for c in _plain(text) + page if c in sliced and c not in head_set})
        if not chars:   # 全部都在第 0 片 (例如只有英數的頁) → 不用自己的檔
            continue
        name = _doc_file(key)
        out = OH_DOC_DIR / name
        txt = OH_DOC_DIR / ".doc.txt"
        txt.write_text("".join(chars), encoding="utf-8")
        fts.main([str(src), f"--text-file={txt}", "--flavor=woff2", f"--output-file={out}"])
        txt.unlink()
        total += out.stat().st_size
        index[key] = {"f": name, "c": "".join(chars)}
    keep = {v["f"] for v in index.values()}
    for old in OH_DOC_DIR.glob("*.woff2"):   # 歌刪掉 / 改名 → 舊檔一起清
        if old.name not in keep:
            old.unlink()
    (OH_DOC_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=0, sort_keys=True) + "\n", encoding="utf-8")
    print(f"✓ public/fonts/openhuninn/doc/ {len(index)} 首, 平均 {total // max(len(index), 1) // 1024}KB, 全部 {total // 1024}KB")


# DotGothic16 (Fontworks, OFL-1.1) — 日文歌詞行 / Live 三頁 / 指令列歌詞結果用的點陣字。
# 以前從 Google Fonts 載, 一頁要抓 ~36 個 unicode-range 小檔; 改成自己放一份子集:
# 字集 = site_charset (全部歌詞/日記/作品全文 + 頁面 UI + 假名全表 + ASCII + 常用標點) ∩ 字型本身有的字。
# 整份 ~170KB 一個檔, 換頁吃快取。來源 pin 在 google/fonts 的某個 commit, 升版改 DG_COMMIT。
DG_COMMIT = "5026800714d07231937d92eb4cceabf06e05d74e"
DG_BASE = f"https://raw.githubusercontent.com/google/fonts/{DG_COMMIT}/ofl/dotgothic16"
DG_DIR = ROOT / "public" / "fonts" / "dotgothic16"


def _fetch(url: str, dest: Path):
    """先寫 .part, 抓完整才換名 — 中途斷線不會留下半個檔, 下次當成快取讀"""
    part = dest.with_name(dest.name + ".part")
    try:
        urllib.request.urlretrieve(url, part)
        part.replace(dest)
    finally:
        part.unlink(missing_ok=True)


def subset_dotgothic():
    from fontTools import subset as fts
    from fontTools.ttLib import TTFont
    src = SRC_DIR / "DotGothic16-Regular.ttf"
    out = DG_DIR / "dg16-site.woff2"
    DG_DIR.mkdir(parents=True, exist_ok=True)
    lic = DG_DIR / "OFL.txt"
    try:
        if not src.exists():
            SRC_DIR.mkdir(exist_ok=True)
            print("↓ 下載 DotGothic16 (~2MB, 只需一次) …")
            _fetch(f"{DG_BASE}/DotGothic16-Regular.ttf", src)
        if not lic.exists():
            _fetch(f"{DG_BASE}/OFL.txt", lic)
    except OSError as e:
        # 抓不到源檔但 repo 裡已經有一份子集: 這輪先沿用舊的, 別讓同一輪的歌詞資料跟著推不出去
        if out.exists():
            print(f"⚠ DotGothic16 下載失敗 ({e}), 沿用現有的 {out.relative_to(ROOT)}, 這輪不重切", file=sys.stderr)
            return
        raise

    have = set(TTFont(src)["cmap"].getBestCmap())
    text = CHARSET.read_text(encoding="utf-8")
    # Live 三頁整頁都是 DotGothic16, 資料 (場次/場地/新聞標題) 比 site_charset 收得多 → 整份資料跟頁面一起收
    for p in list((ROOT / "live").glob("**/*.json")) + list((ROOT / "public" / "live").glob("*/index.html")):
        text += p.read_text(encoding="utf-8")
    text += "".join(chr(c) for c in range(0xFF01, 0xFF5F))   # 全形英數符號 (＆＠ 之類), 便宜的保險
    # site_charset 把空白濾掉了; 半形/不換行空白不收的話, 羅馬拼音行的空格會掉到 monospace 去, 字距跟著變
    chars = sorted({c for c in text + " \u00a0\u3000" if ord(c) in have and (c.isprintable() or c.isspace())})
    txt = DG_DIR / ".charset.txt"
    txt.write_text("".join(chars), encoding="utf-8")
    fts.main([str(src), f"--text-file={txt}", "--flavor=woff2", f"--output-file={out}"])
    txt.unlink()

    # 字型本身有、子集卻沒收到的字 = 管線壞了, 直接報錯
    got = set(TTFont(out)["cmap"].getBestCmap())
    lost = [c for c in chars if ord(c) not in got]
    if lost:
        print(f"✗ dg16 子集漏了 {len(lost)} 字: {''.join(lost[:40])}", file=sys.stderr)
        sys.exit(1)
    # 字型本身就沒有的 (多半是繁中專用字) 照舊 fallback 到 PX10, 跟以前從 Google 載一樣
    print(f"✓ {out.relative_to(ROOT)} ({out.stat().st_size // 1024}KB, {len(chars)} 字)")


def main():
    if not CHARSET.exists():
        print("先跑 scripts/build_site_charset.py", file=sys.stderr)
        sys.exit(1)
    if sys.argv[1:] == ["openhuninn"]:
        subset_openhuninn()
        return
    if sys.argv[1:] == ["dotgothic"]:
        subset_dotgothic()
        return
    for size in SIZES:
        ensure_sources(size)
        for lang in LANGS:
            subset(size, lang)
    subset_openhuninn()
    subset_dotgothic()
    verify_coverage()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
