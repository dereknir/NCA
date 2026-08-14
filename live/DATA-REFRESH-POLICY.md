# DATA-REFRESH-POLICY.md — 資料更新政策(給 Claude Code)

本站對外部資料的總原則,按優先序:
1. **robots.txt 是紅線**——禁自動存取的站,只用人工瀏覽 + 書籤小工具輔助,腳本不碰。
2. **事件驅動優先於排程**——她的活動節奏是月級的,大部分資料不需要「定期」,需要的是「發生時知道」。
3. **對站方的負擔要低到可以忽略**——單請求、不並發、UA 表明非商業粉絲站身分與聯絡方式、失敗不重試(隔日自然重來)、頁面改版就停手回報,永不觸碰售票/登入端點。
4. 頻率寧低勿高。我們是粉絲,不是索引器。

## 資料源清單

| # | 來源 | robots | 方法 | 頻率 | 產物 → 後續 |
|---|------|--------|------|------|-------------|
| 1 | eplus 藝人頁(現售場次) | ✅ 允許 | `watch-eplus.py` 自動(2026-08-11 改吃頁內 JSON-LD Event, 舊文字 regex 已不符現行 markup) | **每日 1 次**(併入 scrape-shorts 日報) | `upcoming.json`;新場次寫進日報信 |
| 2 | 官方 news **RSS feed** `/news/feed/` | ✅ 允許(2026-08-11 重驗: robots 僅禁 /wp-admin/, 且官方在 robots 廣播 sitemap/RSS — 原「禁自動」判斷過時) | `scripts/news_sentinel.py` 自動:抓 feed → 標題【カテゴリ】自動分類 → append news JSON | **每日 1 次**(併入 scrape-shorts 日報) | 年表層全自動;LIVE 類在日報標「events/tours 待補」 |
| 3 | 官方 news 個別文章(巡演日程/場地) | ✅(同上) | **仍人工**:結構化欄位(場地/縣/站點)常在內文甚至圖片, 機器硬解析會安靜地污染地圖/公演史 — 貼內文給 Claude Code 解析入庫 | **事件驅動**:#2 日報出現 LIVE 類時 | `nishina_live_events.json` / `tour_stops.json` 更新 → rebuild-live 自動重建 |
| 4 | lnk.to live_setlist(各場歌單) | ✅ 允許 | 人工書籤(headless 實測拿空殼,不值得對抗) | **事件驅動**:新巡演的 setlist 上架後(約年 1-2 次) | `setlists.json` 更新 |
| 5 | 日本縣界 topojson | — | 靜態 | **永不** | 已內嵌 |
| 6 | (SHORTS 管線) | — | 另案,不在本文件 | — | — |
| 7 | 未來:熱度訊號(YouTube Data API / Spotify / Wikipedia pageviews) | 官方 API,非爬蟲 | API 金鑰 | 週 1 次 | 另案設計,開工前再議 |

## 頻率的理由(讓數字自己辯護)
- 官方 news 年均約 24 條(月均 2)——**月更已綽綽有餘**;真正需要即時的「新場次」由 #1 的 eplus 哨兵日更代勞,官方站因此完全不需要被頻繁打擾。
- eplus 日更 = 每天一個 GET,對售票網站是雜訊級;選日更不是因為資料變快,是為了「新場次公告當天就知道」的通知價值。
- #3/#4 綁定巡演生命週期(公告→結束→setlist 上架),一年各發生 1-2 次,排程毫無意義。

## 更新後的重建流程(已自動化 2026-08-11)
```
更新 data/ 內對應 JSON → push → rebuild-live.yml 自動跑 inject.py → 三頁重建 → Vercel deploy
```
inject.py 有佔位符斷言,注錯會炸,放心跑。哨兵(scrape-shorts 內)的自動變更同 run 內自帶 inject。
每日收穫(shorts/news/eplus)整合成一封日報信,不再分散通知。

## 人工收割 SOP(站長用,約 5 分鐘/次)
1. 瀏覽器開目標頁 → 點「收集」書籤(每頁一次,alert 回報份數)
2. 收完點「匯出」書籤(**必須在同一網域的分頁上點**)
3. JSON 丟給 fable 解析,或未來由 Claude Code 接手解析腳本

## 停手條件
watch-eplus.py 內建:robots 變更自動停;解析到 0 筆(改版徵兆)自動停並要求人工檢查。
人工收割不存在停手問題——人看網頁不需要許可。
