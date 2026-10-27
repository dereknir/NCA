# NCA — にしな 歌詞翻譯與資料站

Derek 的個人網站(https://derekni.com),主體是日本歌手 **にしな (nishina)** 的粉絲資料站:
日文歌詞的繁中翻譯、歌詞分析視覺化、巡演 setlist、公演史與出演足跡、YouTube shorts 花絮、
歌詞卡扭蛋……外加日記與作品集。純靜態 Astro 站, 部署在 Vercel; 資料由 Python 管線與
GitHub Actions 定期更新。

## 站點地圖

| 路徑 | 內容 | 來源 |
|---|---|---|
| `/translations/` | 51 首歌的日/羅馬拼音/繁中對照翻譯, 歌詞頁內嵌 Live Stage (shorts 影片 + 歌詞逐句同步) | `src/content/translations/*.md` + `src/data/shorts_by_song.json` |
| `/lyric-universe/` | 歌詞宇宙: 意象 / 色彩 / 詞彙統計 | `scripts/analyze_lyrics.py` |
| `/kwic/` | 歌詞索引 (KWIC, 依 lemma 倒排) | `scripts/build_kwic.py` |
| `/star-map/` | 歌詞星圖: 句向量 → UMAP 2D → 星座分群 | `scripts/embed_star_map.py` (本機跑) |
| `/setlists/` | 歷年巡演曲目清單 | `scripts/scrape_setlists.py` |
| `/live/` → `timeline` `concerts` `footprint` | 年表 / 公演史 / 出演足跡 (日本地圖) | `live/inject.py` + `live/data/*.json` |
| `/extras/` | 音樂之外的 shorts 分類展示 | `src/data/shorts_extras.json` |
| `/gacha/` | 歌詞卡扭蛋 (canvas 像素卡) | `public/gacha/` |
| `/galaxy/` | 太陽系 hub (shader 行星, 各頁入口) | `public/galaxy/` |
| `/annotate/` | **內部工具**: shorts 歌詞時間點標注器 | `public/annotate/index.html` |
| `/admin/` | **內部工具**: 透過 GitHub API 編輯內容的靜態後台 | `src/pages/admin/` |
| `/diary/` `/projects/` `/about` | 日記、作品集、關於 | `src/content/` |

## 技術

- **Astro 7** (static output) + **Tailwind CSS 4** + MDX; Node 22; `astro check` 做型別檢查
- 像素字型: fusion-pixel (12/10/8px) 與 jf open 粉圓, 依全站字集子集化成 woff2 (`scripts/build_pixel_fonts.py`)
- Python 3.11 資料管線 (`requirements.txt`; 重型 ML 另見 `requirements-ml.txt`)
- 部署: Vercel 讀 `develop` 分支, `vercel.json` 指定 framework preset (astro)、build/dev 指令與輸出目錄

## 本地開發

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 靜態輸出到 dist/
npm run check      # astro check (TS / content schema)

pip install -r requirements.txt      # 資料管線用
python scripts/check_sync.py         # 驗證 public/annotate/ 鏡像與來源一致 (CI 也跑)
```

## 目錄結構

```
src/
  content/translations/*.md   歌詞翻譯 (source of truth; frontmatter schema 在 src/content.config.ts)
  content/diary, projects     日記、作品集
  pages/                      Astro 路由; components/ layouts/ styles/
  data/*.json                 build 時讀的衍生資料 (shorts_by_song, setlists, kwic_index, star_map …)
  config.ts                   站名、導航、社群連結
public/
  annotate/ gacha/ galaxy/ kwic/ lyric-universe/ star-map/ live/   不經 Astro 的靜態子站 (多為腳本注入資料的單檔 HTML)
  covers/ fonts/ og/          封面圖、字型子集、OG 分享圖
data/                         管線中繼檔 (lyrics.json, nishina_shorts*.json, site_charset.txt, vectors_q8.json)
scripts/                      Python 管線 + 注入用 HTML 模板
annotation/                   shorts 標注工作區 (HANDOFF.md 有完整背景)
live/                         live 三頁的模板、資料、inject.py、eplus 哨兵 (DATA-REFRESH-POLICY.md)
docs/                         設計討論與規格 (STAGE-SPEC.md 等)
.github/workflows/            五支 Actions (見下)
```

## 資料管線

### 歌詞 (md → 衍生資料)
```
src/content/translations/*.md
  └─ scripts/export_lyrics_json.py  → data/lyrics.json (+ 鏡像 public/annotate/lyrics.json)
       ├─ scripts/analyze_lyrics.py   → src/data/lyric_universe.json + public/lyric-universe/index.html
       ├─ scripts/build_kwic.py       → src/data/kwic_index.json + public/kwic/index.html
       └─ scripts/embed_star_map.py   → src/data/star_map.json + public/star-map/index.html (本機, e5 模型)
scripts/build_site_charset.py → data/site_charset.txt → scripts/build_pixel_fonts.py → public/fonts/
```
一鍵: `python scripts/refresh_data.py` (export → analyze → kwic)。

### Shorts (YouTube → 標注 → 歌詞頁)
```
yt-dlp (@nishina__official/shorts) → data/nishina_shorts_raw.jsonl (gitignored)
  └─ scripts/clean_shorts.py       → data/nishina_shorts.json
       ├─ scripts/classify_shorts.py             → data/nishina_shorts_classified.json (花絮分類)
       ├─ annotation/build_annotation_queue.py   → annotation/annotation_queue.json (+ 鏡像 public/annotate/)
       └─ scripts/build_recent_new.py            → annotation/recent_new_shorts.json (日報用)
annotator (/annotate/) 人工或 scripts/auto_annotate.py (ASR, 本機跑; scripts/eval_align.py 離線評估對齊) 標時間點
  └─ annotation/shorts_anchors.json  (source of truth, annotator 直接 push 到 GitHub)
       ├─ scripts/import_anchors.py        → src/data/shorts_by_song.json / shorts_extras.json / shorts_tours.json
       └─ scripts/build_gacha_live_pool.py → public/gacha/live_pool.json
```

### Live 資料
`live/data/*.json` (news / events / tours / setlists 連結 / 出演系列 / 日本地圖) → `live/inject.py`
→ `public/live/{timeline,concerts,footprint}/index.html` + `public/live/events.json` + `public/annotate/appearances.json`。
更新政策與各資料源的抓取頻率見 `live/DATA-REFRESH-POLICY.md`。

## GitHub Actions

| Workflow | 觸發 | 做什麼 |
|---|---|---|
| `ci.yml` | 每次 push / PR | `check_sync.py` → `npm ci` → `astro check` → `astro build` (唯讀) |
| `scrape-shorts.yml` | 每日 03:00 台北 / 手動 | yt-dlp 抓 shorts → 全部衍生檔 → eplus / 官方 news 哨兵 → live 重建 → commit → 日報 email |
| `sync-derived.yml` | push `annotation/shorts_anchors.json` | annotator 存檔後 30 秒內重生 shorts_by_song / extras / gacha live pool |
| `refresh-lyric-data.yml` | push `src/content/translations/**.md` | lyrics.json → 歌詞宇宙 / KWIC → 字型子集重生 |
| `rebuild-live.yml` | push `live/data/**.json` 或模板 | `inject.py` 重建 live 三頁 |

資料 workflow 都只 commit 明確列出的衍生檔, 且從不 push 自己的觸發路徑, 不會互相迴圈。

## 相關文件

- `annotation/HANDOFF.md` — shorts 標注系統的背景、格式與操作
- `live/DATA-REFRESH-POLICY.md` — 外部資料源的抓取原則 (robots、頻率、停手條件)
- `live/MANIFEST.md` — live 頁與宇宙 hub 的檔案清單
- `docs/STAGE-SPEC.md` — 歌詞頁 Live Stage 的實作規格
- `public/gacha/README.md` — 扭蛋原型說明

## 素材與致謝

行星 shader 改編自 Deep-Fold「PixelPlanets」(MIT) 的 Unity 移植版 hmcGit/UniPixelPlanet (MIT);
像素字型 fusion-pixel-font (OFL-1.1); 內文字型 jf open 粉圓 (OFL-1.1) 與 DotGothic16 (OFL-1.1);
日本地圖 dataofjapan/land (Natural Earth, 公有領域)。歌詞與影片版權屬原權利人, 影片一律以 YouTube 官方 IFrame 嵌入。
