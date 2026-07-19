# 歌曲詳情頁 layout 討論 —— 交給 Fable

> 給 Fable 的完整背景說明。目標是找出比現行「Option A: sticky 側欄 + tabs」更好的版面配置方向。
> Derek（站長）覺得目前的實作**不夠滿意**，希望重新思考。

---

## 這是什麼站

- **にしな 中文翻譯站**（[nishina](https://www.youtube.com/@nishina__official)——日本 J-POP 女歌手）
- **Astro 6** + Tailwind v4 (`@tailwindcss/vite`) + 自寫的 `.prose` CSS（**不是**用 typography plugin）
- 43 首歌 × 三語對照（羅馬拼音 + 日文 + 繁中）
- 深藍色 dark theme（同時支援 light mode）
- 部署在 Vercel

## 每首歌的內容組成

每首歌的 markdown 檔會有下列 H2 sections（有先後順序，非全都有）：

| Section | 字數量級 | 說明 |
|---|---|---|
| Header（frontmatter 渲染） | — | 封面 224×224、標題、album/track、作詞作曲、發行日、tags |
| `## 歌曲介紹` | 200–800 字 | 這首歌的中文導讀 |
| `## 歌詞 / 翻譯` | **核心** | 20–60 行三語歌詞（romaji + ja + zh），每行用 `<div class="lyrics-line">` 包裹 |
| `## 翻譯筆記` | **3000–8000 字** | 8 段結構化 H3（`### 1. XXX` ~ `### 8. XXX`）+ 詞句考證 |
| `## 創作背景`（部分歌才有） | 500–2000 字 | 訪談摘錄、podcast 內容 |
| 收尾 bold paragraph | 100–300 字 | 整首歌的收束語 |

**歌詞的視覺結構**（重要 —— layout 要能承載）：

```html
<div class="lyrics-line">
  <div class="romaji">sou ieba kesa jikka kara ringo todoiteta yo</div>
  <div class="ja">そういえば今朝実家からリンゴ届いてたよ</div>
  <div class="zh">對了 今天早上老家寄了蘋果過來喔</div>
</div>
```

**三語堆疊、每行一組**，一行日文可能長達 40 字以上，加羅馬拼音更長。

## 新加入的功能：YouTube Shorts

- 從にしな 官方 YouTube 頻道爬 1283 支 shorts
- 43 首歌中目前只有 1 首（ワンルーム）已標註完 11 支 shorts
- **每支 short** 有 anchors（`{t: 秒數, line: 歌詞行 index}` 陣列）
- 播放時歌詞行會逐句 highlight
- Shorts 分四種版本：**LIVE / MV / 弾き語り / 其他**（tab 過濾用）
- 每支 short 是 9:16 直式，播放器 240px 寬右下角 sticky

**關鍵 UX 觀察**：**Shorts 播放時，使用者會想邊看 shorts 邊看歌詞 highlight**——這是 shorts+歌詞並列的意義所在。

---

## 現行實作（Option A）

```
┌────────── max-w-4xl (896px) ────────────────────────┐
│                                                      │
│  [Cover 224px]  ワンルーム                            │
│                 1999 (2022) · Track 7                │  ← Header 全寬
│                 作詞/作曲                              │     不進 grid
│                 tags                                  │
│                                                      │
├─────────────────────────────┬────────────────────────┤
│                             │  [🎬 Shorts 11] [📖 介紹] [✍️ 解析]  │
│  歌詞 / 翻譯                 │  ─────────────────────  │
│  ~545px 寬                  │                        │
│  (原本 896px 全寬)           │  (該 tab 內容)          │  ← sticky top: 5rem
│                             │  overflow-y: auto      │     max-h: 100vh-6rem
│                             │  ~351px 寬              │
│  ...                        │                        │
│                             │                        │
│                             │                        │
│                             │                        │
└─────────────────────────────┴────────────────────────┘
     1.55fr                            1fr
```

**技術實作**：
- 伺服端整份 `<Content />` 渲染進 `.prose[data-song-content]`
- Client-side blocking inline script 掃 H2 邊界，把「歌曲介紹」的節點移到 `[data-panel="intro"]`、「翻譯筆記」+「創作背景」移到 `[data-panel="notes"]`
- 「歌詞 / 翻譯」留在原位（主欄）
- Shorts 面板由 SongShorts.astro 元件渲染
- 手機（<900px）：grid 變單欄，側欄 sticky 拿掉，直接 stack

**觀察到的問題**：

1. **歌詞欄變窄 40%（545px vs 原本 896px）**——三語歌詞需要至少 700-900px 才舒服。目前很多長行會斷得很醜。**這是 Derek 說「原本寬版比較好看」的原因。**

2. **Header 右邊一大片空白**——因為 header 是 grid 外的全寬 block，側欄才從 grid 開始的位置出現。視覺上頁面上半部右邊有一大塊死區。

3. **側欄不像 sidebar 像 aside 貼片**——因為它太晚才出現，感覺是「附加」的，不是主結構。

4. **Shorts 的縮圖 grid 在 351px 側欄裡很擠**——縮圖降到 `minmax(110px, 1fr)` 才勉強擺得下 2 欄，但每張縮圖太小、標題文字看不清。

---

## 已提過但都不夠好的三個選項

### 選項 1：只加寬容器 + 調比例

`max-w-4xl (896px) → max-w-7xl (1280px)`、grid ratio `1.55:1 → 2:1`。
歌詞回到 ~850px，側欄還有 430px。

**問題**：右上空白沒解、只是把 Option A 的問題放大到更寬的容器。

### 選項 2：Header 進 grid，側欄從頂端開始

Header 只佔 grid 左欄，側欄從頁面最頂就 sticky。

**問題**：好一點但沒解決「歌詞 vs 側欄爭寬」的根本問題；封面 + 標題本身不那麼適合擠在 grid 一欄裡（設計美感考量）。

### 選項 3：放棄常駐側欄，改浮動抽屜

歌詞全寬，右邊懸浮 3 顆按鈕，點按鈕抽屜滑進來。

**問題**：**違背當初選 Option A 的初衷**——「一邊看歌詞一邊播 shorts 一邊 highlight」。抽屜關掉就看不到歌詞 highlight 意義何在。

---

## 硬約束（不能改的）

- **歌詞永遠不能藏在 tab / 收合區塊裡**——那是使用者來這頁的核心目的
- **markdown 結構是 source of truth**——不能為了 layout 去改動 43 個 md 檔的結構
- **Shorts 播放時歌詞和 shorts 需要同時可見**——否則 anchor highlight 沒意義
- **手機必須降級**（<900px 至少要能用）
- **Light / Dark mode 都要好看**
- **SEO 友善**（所有內容在 DOM 裡，不能純 CSR）

## 軟約束（希望達成）

- **歌詞閱讀時感覺寬敞**（>700px 為佳，接近 900px 更好）
- **Shorts 隨手可及**（縮圖清楚可辨、hover/tap 就播）
- **不要「一路無盡下捲」**——3000-8000 字的翻譯筆記如果全展開太累
- **視覺意圖清楚**——不像「隨便堆」
- **43 首歌的 layout 一致**（但不同歌有無 shorts / 無創作背景，layout 要能自然處理缺席）

---

## Derek 沒明說但重要的判斷

- **喜歡標注工具（`annotator.html`）的三欄配置**（左 queue、中 player、右 lyrics）——覺得很好看、想比照
- **喜歡「原本的寬版」歌詞閱讀感**
- **不喜歡目前一堆內容一路往下堆的感覺**——是這場討論的起點

矛盾點：
- 「三欄看起來爽」+「歌詞要寬」+「內容不要一路堆下去」→ **三個訴求同時滿足很難**

---

## 給 Fable 討論的問題

1. **有沒有一種 layout 能同時滿足**：
   - 歌詞寬（700–900px）
   - Shorts + 歌詞並列（播放時同步 highlight）
   - 介紹 / 解析不消失也不擠爆頁面
   - 不「無盡下捲」
   - 43 首歌通吃（有/無 shorts、有/無創作背景）

2. **是否應該考慮**：
   - **Reader mode / Focus mode 切換**（一個按鈕在「寬版純歌詞」和「多欄豐富資訊」之間切）
   - **不同螢幕寬度不同 layout**（超寬螢幕才啟用 3 欄，一般桌機退化為 2 欄或單欄 + 增強設計）
   - **音樂串流平台（Spotify、Apple Music）的參考模式**——它們怎麼處理「歌曲 + 歌詞 + 相關內容」的並列？
   - **Notion / Substack / Genius Lyrics** 這類長文閱讀站的排版慣例？

3. **Layout 之外的想法**：
   - **是否用 typography 節奏**（字級、行距、留白）就能解決「一路下堆」的感覺，不必動 layout？
   - **是否用 visual anchors**（每個 section 起頭一張美圖、封面重複、色塊分隔）讓長頁面有節奏？
   - **是否用 scroll-linked 動畫**（section 進入視窗時淡入、封面視差）減緩「疲勞感」？

## 附錄：現行 3 個 tabs 的實際內容規模（以 ワンルーム 為例）

- **Shorts**: 11 支縮圖 grid，各 100×178 直式，有版本 badge、標題、view count
- **介紹**（歌曲介紹）: 3 段落，~500 字
- **解析**（翻譯筆記 + 創作背景）: 8 個 H3 章節 + 收尾 bold paragraph，總計 ~6500 字

## 附錄：目前檔案位置

- Layout 檔：`src/pages/translations/[id].astro`（Astro page）
- Shorts 元件：`src/components/SongShorts.astro`
- 舊 LiveShorts 元件（沿用中）：`src/components/LiveShorts.astro`
- Prose CSS：`src/styles/global.css`
- Shorts 資料：`src/data/shorts_by_song.json`
- Markdown 內容：`src/content/translations/*.md`

---

**Fable，接下來給你自由發揮。可以完全推翻 Option A，也可以在它上面調整。歡迎給 3-5 個方向並附上優缺點，讓 Derek 挑。**
