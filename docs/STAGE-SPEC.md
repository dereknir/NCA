# LIVE STAGE 實作規格 — 歌曲詳情頁重構(方向 3)

> 給 Claude Code。背景:現行「sticky 側欄 + tabs」版面(Option A)確定廢棄,
> 改為「單欄寬版頁面 + 全螢幕 Live Stage」。本文件是完整實作規格。
> 相關既有文件:HANDOFF.md(shorts 標注流水線背景)、song-page-layout-discussion.md(版面討論脈絡)。

---

## 0. 一句話總結

頁面回到單欄 896px 寬版(歌詞讀起來爽);shorts 以橫向架呈現;
點縮圖進入全螢幕 **Live Stage**:影片 + 大字歌詞 karaoke 同步。

## 1. Phase 1 — 頁面重構(純減法,先做)

### 1.1 拆除
- `[id].astro` 的兩欄 grid、tabs、sticky 側欄
- **搬移 DOM 的 client-side blocking inline script(整段刪除)** — 掃 H2 把節點搬進 panel 那段
- 舊 `LiveShorts.astro` 停用

### 1.2 新的頁面流(單欄, max-w-4xl = 896px, 全部在文件流內)
1. Header(維持現狀,全寬)
2. `## 歌曲介紹`
3. **Shorts 架**(僅在該曲有 shorts 時渲染, 見 §2)
4. `## 歌詞 / 翻譯`(回到全寬,不做任何欄位犧牲)
5. `## 翻譯筆記`(章節化排版,見 §3)
6. `## 創作背景`(有才渲染)
7. 收尾 bold paragraph

markdown 結構不動,只是不再用 JS 搬節點——所有 section 按原始順序渲染。

### 1.3 Shorts 架(新元件 `ShortsShelf.astro`)
- 橫向捲動列, `scroll-snap-type: x mandatory`, 縮圖 9:16 約 130×230
- 每張卡:縮圖(用 `shorts_by_song.json` 內既有 thumbnail URL)、版本 badge、標題、view count
- 架上方一排 filter chips:全部 / LIVE / MV / 弾き語り / 其他
- 點卡片 → 開啟 Stage(§4),並傳入 videoId
- 桌機顯示左右捲動箭頭;行動裝置原生滑動
- 無 shorts 的歌:整個元件不渲染,頁面自然是純文章

### 1.4 筆記章節化(只動 CSS + 少量結構)
- `### 1.` ~ `### 8.` 章節:開頭字級加大(h3 上方 margin 拉開,加細分隔線)
- ≥1280px:左側空白處 scrollspy 細目錄(介紹/Shorts/歌詞/筆記各章/背景),
  寬約 160px,position: fixed 於左 margin,IntersectionObserver 追蹤
- <1280px:不顯示目錄(或收為浮動「章節」按鈕,可後補)
- 內容全在 DOM,不做 accordion,SEO 無損

## 2. Phase 2 — Live Stage(全螢幕 overlay)

### 2.1 開啟/關閉
- 開啟:點 Shorts 架任一卡片
- `document.body` scroll lock;`history.pushState` 加 `#live={videoId}`
- 關閉:X 按鈕 / Esc / 瀏覽器返回鍵(popstate handler)→ 移除 hash、解鎖捲動、銷毀 clone
- 頁面載入時若 URL 已帶 `#live={videoId}` 且該 id 在此曲 shorts 內 → 自動開啟 Stage(**深連結,分享用,重要**)

### 2.2 佈局
- overlay: `position: fixed; inset: 0; z-index` 最高;**永遠深色**,不跟隨 light mode(影院慣例)
- 背景:該曲封面圖 `filter: blur(60px) brightness(0.35)` 鋪滿 + 深色遮罩,每首歌自帶氛圍色
- **≥1024px(並排)**:左欄影片(9:16,高 78vh → 寬約 44vh,置中),右欄歌詞(佔剩餘寬,最大 720px)
- **<1024px(堆疊)**:影片置頂 sticky(高 ~38vh),歌詞在下方捲動
- 頂列:歌名 + 版本 tabs(此曲全部 shorts,依版本分組) + 關閉鈕
- `aria-modal="true"` + focus trap;開啟時 focus 移入,關閉時還原

### 2.3 歌詞渲染 — **clone 策略(定案,不要改成搬移)**
- 開啟時 `lyricsContainer.cloneNode(true)` 塞進 Stage 右欄
- 關閉時直接丟棄 clone;原始 DOM 全程不動(捲動位置、SEO、Astro hydration 都不受影響)
- Stage 內樣式:ja 字級 ~26px、zh ~15px,行距拉開;romaji 預設隱藏(右上角小 toggle 可開)
- 非 active 行降低透明度(~0.45),active 行全亮 + 微放大 — Apple Music 質感

### 2.4 同步邏輯(核心,可整段參考 annotator.html 的 startPoll)
- YouTube IFrame API,單一 player 實例,切版本用 `loadVideoById`
- 250ms poll `getCurrentTime()` → 在該 short 的 anchors(已按 t 排序)做**二分搜尋**找 active line
- active line 變更 → highlight + `scrollIntoView({block:'center', behavior:'smooth'})`
- **跟隨捲動開關**:使用者手動捲歌詞 → 自動暫停跟隨,浮出「回到目前句」按鈕;點擊恢復
- 點任一歌詞行 → `seekTo(該行 anchor 的 t)`(反向導航);行沒有 anchor 則 seek 到前一個 anchor
- `prefers-reduced-motion` → scrollIntoView 用 `behavior:'auto'`,取消放大動畫

### 2.5 版本切換
- 頂列 tabs 依版本分組(LIVE / MV / 弾き語り / 其他),tab 內若同版本多支則橫列小縮圖
- 切換 = `loadVideoById` + 換 anchors 陣列 + 重置跟隨狀態;不關閉 Stage
- 影片播完:停在結尾畫面 + 浮出「重播 / 下一支」;不自動跳(使用者可能在讀歌詞)

### 2.6 錯誤處理
- IFrame `onError` 101/150(禁止嵌入)→ Stage 內顯示「此影片不允許嵌入,到 YouTube 觀看」+ 外連;版本 tab 標灰
- player ready 前的操作全部 queue 住(annotator 已有此 race condition 的教訓)

## 3. 狀態機

| 狀態 | 進入條件 | 離開 |
|---|---|---|
| closed | 預設 / 關閉動作 | 點卡片 / 深連結 → opening |
| opening | 建 overlay + clone + player load | onReady → playing |
| playing(follow=on) | 預設播放 | 手動捲動 → follow=off;關閉 → closed |
| playing(follow=off) | 使用者捲動 | 點「回到目前句」→ follow=on |
| switching | 點版本 tab | loadVideoById 完成 → playing |

## 4. 檔案異動

| 檔案 | 動作 |
|---|---|
| `src/pages/translations/[id].astro` | 重寫:拆 grid/tabs/搬移 script,單欄流,掛 Shelf + Stage |
| `src/components/ShortsShelf.astro` | 新增 |
| `src/components/LiveStage.astro` | 新增(overlay + player + 同步) |
| `src/components/SongShorts.astro` | 廢棄(邏輯併入上面兩個) |
| `src/components/LiveShorts.astro` | 廢棄 |
| `src/styles/global.css` | 加:shelf、stage、筆記章節、scrollspy 目錄樣式 |
| `src/data/shorts_by_song.json` | 不動(schema 見 HANDOFF.md) |

## 5. 驗收清單

- [ ] 歌詞欄寬 = 896px(桌機),長行不再醜斷
- [ ] 無 shorts 的歌:頁面無任何空殼元件
- [ ] ワンルーム(唯一已標注曲):架上 11 支、Stage 同步 highlight 正確、點行 seek 正確
- [ ] `#live=VIDEOID` 深連結直接開 Stage;返回鍵關閉;重新整理保持
- [ ] 手動捲動暫停跟隨、「回到目前句」恢復
- [ ] 禁止嵌入的影片有 fallback
- [ ] light mode 頁面正常;Stage 恆為深色
- [ ] 手機(<900px):堆疊佈局可用;`prefers-reduced-motion` 生效
- [ ] Lighthouse:原歌詞 DOM 未被 Stage 影響(SEO 檢查)

## 6. 明確不做(v1 範圍外)

- 逐字 karaoke(anchor 維持句級;schema 已預留 `char` 欄位)
- 每句歌詞旁的「聽 live」小按鈕(未來可加,入口先只有 Shelf)
- Stage 內留言/分享面板
- 無標注 shorts 的「純播放」Stage(v1 只開放有 anchors 的;無 anchors 的卡片點擊直接外連 YouTube)
