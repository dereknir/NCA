# HANDOFF — にしな Shorts 歌詞同步標注系統

> 給 Claude Code 的完整背景說明。讀完這份就能接手。

## 專案是什麼

Derek 經營一個 にしな(nishina)歌詞翻譯網站(Next.js/Astro 類前端,部署在 Vercel,深藍色 dark theme,43 首歌、日文/羅馬拼音/繁中三語對照)。目標新功能:**在每首歌的歌詞頁嵌入該曲的 YouTube live shorts,播放時歌詞逐句 highlight 同步**。一首歌可能有多個 live 版本(多個 tab / 時間軸)。

因為 shorts 是從演出隨機剪的、長度不一,無法自動知道影片從歌的哪一句開始 → 需要人工標注「時間點 ↔ 歌詞行」的 anchor。本套件就是為此建的標注流水線。

## 已完成的東西(本資料夾)

| 檔案 | 角色 | 狀態 |
|---|---|---|
| `nishina_shorts_raw.jsonl` | yt-dlp 抓的官方頻道全部 1282 支 shorts metadata | ✅ 資料已抓 |
| `lyrics.json` | 43 首歌的歌詞庫,`meta.schema` 內有完整欄位文件 | ✅ 從網站 md 生成 |
| `build_annotation_queue.py` | 配對腳本:hashtag + 歌詞句模糊比對(rapidfuzz) | ✅ 已跑通,可重跑 |
| `annotation_queue.json` | **標注佇列**:36 首歌/100 支(每首取觀看數 top 3) | ✅ 已生成 |
| `review_queue.json` | 配不到或低信心的(cover、庫外新歌、非歌曲) | ✅ 已生成 |
| `annotator.html` | **標注工具本體**,單檔,無 build step | ⚠️ 核心完成,未經真機測試 |

### 配對的實測數字(2026-07-17)
hashtag 命中 283、歌詞句比對命中 167(partial_ratio ≥ 85)、
review 389(65–85 分)、庫外 428(多為 cover 或未收錄新歌如クローバー)、非歌曲 15。

## annotator.html 怎麼用

```bash
# 三個檔案放同一資料夾
python -m http.server 8000
# 開 http://localhost:8000/annotator.html
```
(必須走 http;file:// 下 YouTube IFrame API 會有 origin 問題,此時工具會退到拖放載入模式,但播放器可能仍受限)

操作:左欄選 short → 中欄播放 → **影片唱到某句的瞬間,點右欄那句歌詞** = 打一個 anchor(記錄 `{t: 目前秒數, line: 歌詞行 index}`)。紫框標「標題句?」的是配對腳本猜的起始句(shorts 標題通常就是開頭那句歌詞),會自動捲到附近。anchors 打完會即時做同步預覽(播放時 highlight 跟著跑,和正式網站要做的行為一致,可直接驗證標得準不準)。Enter 完成跳下一支;進度自動存 localStorage,「匯出」產生 `shorts_anchors.json`。

### 匯出格式(= 網站正式功能要吃的資料)
```json
{
  "VIDEO_ID": {
    "songId": "nishina-plum",
    "anchors": [ { "t": 3.42, "line": 14 }, { "t": 7.80, "line": 15 } ],
    "status": "done"
  }
}
```
`line` 對應 `lyrics.json` 的 `lyric_lines[].index`。

## 待辦(請 Claude Code 接手)

1. **真機測試 annotator.html**:YouTube IFrame API 在本環境無法連網測試。已知風險:部分影片禁止嵌入(error 101/150)→ 需加 `onError` handler 顯示「此片不可嵌入」並提供略過;`loadVideoById` 在 player 未 ready 時呼叫的 race condition。
2. **正式網站端 component**:讀 `shorts_anchors.json`,在歌詞頁渲染多版本 tab + 播放同步。同步邏輯直接抄 annotator 的 `startPoll()`(250ms poll + 線性掃 anchors;正式版建議改二分搜尋)。點歌詞句 → `seekTo(anchor.t)` 反向導航。
3. **review_queue 的處理介面**(可選):389 支 review 目前只能改 JSON,可在 annotator 加一個「人工指定歌曲」下拉。
4. **增量更新**:にしな發新 shorts 後重跑 yt-dlp + `build_annotation_queue.py`,以 videoId diff 出新增項。可做成 script,不急。

## 設計約定(不要改的東西)

- anchor 是**句級**,不做逐字。schema 預留擴充:未來要逐字時在 anchor 加可選 `char` 欄位,向後相容。
- `lyrics.json` 由網站的 `src/content/translations/*.md` 生成,是下游產物——歌詞內容有錯要改上游 md,不要直接改這個 JSON。
- 嵌入一律走 YouTube 官方 IFrame(videoId),不下載、不轉載影片內容,版權乾淨。
- 標注工具是內部工具,不部署到 production;將來若放進 repo,置於 dev-only 路由或獨立資料夾。

## Derek 的工作習慣(協作參考)

直接的技術溝通;偏好可以複製貼上的交付物;迭代式共編而非一次性重寫;明確區分「確定的事實」和「不確定的推測」。有不確定就說,不要編。
