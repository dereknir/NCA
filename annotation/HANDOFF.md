# HANDOFF — にしな Shorts 歌詞同步標注系統

> 給 Claude Code 的完整背景說明。讀完這份就能接手。

## 專案是什麼

Derek 經營一個 にしな(nishina)歌詞翻譯網站(Next.js/Astro 類前端,部署在 Vercel,深藍色 dark theme,全部歌曲(目前 51 首)日文/羅馬拼音/繁中三語對照)。目標新功能:**在每首歌的歌詞頁嵌入該曲的 YouTube live shorts,播放時歌詞逐句 highlight 同步**。一首歌可能有多個 live 版本(多個 tab / 時間軸)。

因為 shorts 是從演出隨機剪的、長度不一,無法自動知道影片從歌的哪一句開始 → 需要人工標注「時間點 ↔ 歌詞行」的 anchor。本套件就是為此建的標注流水線。

## 已完成的東西(本資料夾)

| 檔案 | 角色 | 狀態 |
|---|---|---|
| `../data/nishina_shorts.json` | yt-dlp 抓的官方頻道全部 shorts metadata(`scripts/clean_shorts.py` 精簡版, 每日 workflow 更新) | ✅ 資料已抓 |
| `../data/lyrics.json` | 全部歌曲的歌詞庫,`meta.schema` 內有完整欄位文件(本資料夾不再放副本, 直接讀 `data/`) | ✅ 從網站 md 生成 |
| `build_annotation_queue.py` | 配對腳本:hashtag + 歌詞句模糊比對(rapidfuzz);路徑以 repo root 為準, 任何 cwd 都能跑 | ✅ 已跑通,可重跑 |
| `annotation_queue.json` | **標注佇列**:全部 shorts 依歌分組(預設 top-n 0 = 全留;2026-10 為 42 首歌有配對 / 1388 支),鏡像到 `public/annotate/` | ✅ 每日 workflow 重生 |
| `review_queue.json` | 配不到或低信心的(cover、庫外新歌、非歌曲) | ✅ 已生成 |
| `../public/annotate/index.html` | **標注工具本體**,單檔,無 build step;部署在站上 `/annotate/`(本資料夾不再放舊副本) | ✅ 已上線, 含 🤖 待審審核模式 |

### 配對的實測數字(2026-07-17)
hashtag 命中 283、歌詞句比對命中 167(partial_ratio ≥ 85)、
review 389(65–85 分)、庫外 428(多為 cover 或未收錄新歌如クローバー)、非歌曲 15。

## annotator 怎麼用

```bash
npm run dev
# 開 http://localhost:4321/annotate/
# (或不開 astro: cd public && python -m http.server 8000 → http://localhost:8000/annotate/)
```
工具讀同目錄的 `annotation_queue.json` / `lyrics.json` / `setlists.json` / `appearances.json` / `auto_anchors.json`,
這些都是 `public/annotate/` 下由腳本鏡像過去的副本(來源分別是 `annotation/annotation_queue.json`、
`data/lyrics.json`、`src/data/setlists.json`、`live/data/`、`annotation/auto_anchors.json`;`scripts/check_sync.py` 在 CI 驗證一致)。
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
`line` 對應 `data/lyrics.json` 的 `lyric_lines[].index`。

## 待辦(請 Claude Code 接手)

1. **真機測試 annotator**:YouTube IFrame API 在本環境無法連網測試。已知風險:部分影片禁止嵌入(error 101/150)→ 需加 `onError` handler 顯示「此片不可嵌入」並提供略過;`loadVideoById` 在 player 未 ready 時呼叫的 race condition。
2. **正式網站端 component**:讀 `shorts_anchors.json`,在歌詞頁渲染多版本 tab + 播放同步。同步邏輯直接抄 annotator 的 `startPoll()`(250ms poll + 線性掃 anchors;正式版建議改二分搜尋)。點歌詞句 → `seekTo(anchor.t)` 反向導航。
3. **review_queue 的處理介面**(可選):389 支 review 目前只能改 JSON,可在 annotator 加一個「人工指定歌曲」下拉。
4. **增量更新**:にしな發新 shorts 後重跑 yt-dlp + `build_annotation_queue.py`,以 videoId diff 出新增項。可做成 script,不急。

## 🤖 機器自動標註與審核(scripts/auto_annotate.py)

本機 ASR 幫未標的 shorts 先打一版 anchors,人工在 annotator 的「🤖 待審」模式審核。
音訊快取在 `~/nca-audio-cache`(Windows 為 `%LOCALAPPDATA%/nca-audio-cache`),重跑不用重新下載。

**建議用 `--engine hybrid`**:Qwen3-ASR 決定「哪幾句」,whisper 給「幾秒」。golden set 40 支(人工 done,`--validate` 同一批)的比較:

| 引擎 | anchors 召回 | 精確 | 時間誤差 ≤1s | A/B/C 級 |
|---|---|---|---|---|
| whisper small | 70% | 91% | 87% | 24/7/9 |
| whisper medium | 71% | 89% | 91% | 28/5/7 |
| whisper large-v3-turbo | 70% | 89% | 89% | 28/5/7 |
| whisper medium + `--vad` | 6% | — | — | 不能用 |
| Qwen3-ASR(`--engine qwen`) | 79% | 95% | 83% | 29/5/6 |
| **hybrid(`--engine hybrid`)** | **79%** | **95%** | **89%** | 29/5/6 |

- whisper 換大模型沒有幫助(small / medium / turbo 只是在不同影片上各自翻車)。
- `--vad` 會把有伴奏的歌聲當成非人聲切掉,不要用。
- Qwen 的句子判斷明顯較準(認歌信心分數常在 80–95,whisper 多在 50 上下),但它的時間點(ForcedAligner)在歌聲上比 whisper 的 word timestamp 粗;拿正確歌詞原文強制對齊也沒有更好,所以 hybrid 只借 whisper 的時間。

環境(獨立 venv,Apple Silicon 走 MPS、NVIDIA 走 CUDA,需要系統 ffmpeg):
```bash
python3.12 -m venv .venv-qwen && .venv-qwen/bin/pip install -r requirements-qwen.txt
```

流程(都在 repo root):
```bash
.venv-qwen/bin/python scripts/auto_annotate.py --validate --limit 40 --engine hybrid   # golden set 驗證 (不寫檔)
.venv-qwen/bin/python scripts/auto_annotate.py --redo --engine hybrid                  # 全量重標: 所有非 done/skip 重跑
.venv-qwen/bin/python scripts/auto_annotate.py --merge                                 # 寫進 shorts_anchors.json (status=auto)
python scripts/eval_align.py -v                                                        # 不跑 ASR: 用既有逐字稿離線評估「標了哪幾句」
.venv-qwen/bin/python scripts/eval_golden.py --dump                                    # 所有人工 done 轉寫一次存快取 (~7s/支, 可續跑)
.venv-qwen/bin/python scripts/eval_golden.py [--split dev|test|all] [-v]               # 改演算法後用全部 done 評估 (幾秒)
```

- `--merge` 永遠不碰 `done` / `skip`,也不碰人工已開始打 anchor 的 `pending`;覆蓋既有 auto 時保留人工填過的版本 / 巡演 / 場次欄位。
- whisper 引擎預設只轉寫一遍、不給歌詞 prompt;`--prompt-pass` 會用歌詞當 prompt 再轉一遍,但 whisper 會把 prompt 原句抄進輸出,只當實驗選項。佇列的標題句(lineHint)不影響結果。
- 認歌規則(v2,`decide_song`):模型清楚認出(第一名 ≥45 分且領先第二名 ≥10 分)就相信模型;模型沒把握才參考佇列的 hashtag / 歌詞比對配對,低信心的 review 配對一律不當提示。舊規則「第一名 <68 分就沿用佇列」是照 whisper 分數訂的,全量重標時讓 140 支被佇列帶偏;新規則在人工確認歌名的 159 支上 157 對(舊 122)、golden 40 支 39 對(舊 37),且不推翻任何 hashtag。
- **v3(`ALGO = 3`)**:鏈的頭尾往外延伸(人工補的句子九成在片段頭尾);hybrid 換時間改成「whisper 有對到同一句就用 whisper 的」(不再限 3 秒內);歌詞的括號讀音「虚像(うそ)」改用讀音比對。實驗過程與數字見 `annotation/reports/2026-10-27-align-v3.md`。
- hybrid 借 whisper 時間時必須維持句子順序與 ≥0.6 秒間隔,否則該句改成前後兩句之間內插;Qwen 評為 C 級時改用同時跑好的 whisper 轉寫再分析一次,取較好的(`fallback: whisper`)。
- 結果帶 `algo` 版本號;`--redo` 會重跑舊版本的結果(結果檔沒存逐字時間,所以要重新轉寫)。
- 已知弱點:歌詞完全相同的重複段(副歌)聽不出是第幾次。人工標註裡第一次 / 最後一次各占一半,用頭尾殘句比對前後文也只能分出 3/19 支,這類交給人工耳朵判斷 — annotator 會自動顯示「⚠ 重複段 第 1 次 / 第 2 次…」,點一下(或按 `r`)整組 anchors 平移到那一段,時間不動。

### annotator 的審核模式
- `🤖 待審 N`:只列 status=auto 的;`⚠ 先確認歌 M`:只列 ASR 認的歌跟佇列 hashtag / 歌詞配對不一致的,面板會寫出兩邊各認為是哪首。
- 歌曲 / 類別下拉釘在歌詞欄最上方(以前會跟著歌詞捲走,看起來像消失);播放器下方另有一排「非歌曲」快捷鍵,點了直接完成並跳下一支待審。
- Enter = 審核通過(done)並跳「目前這支之後」的下一支;「建議不對,退回手動」會清掉機器 anchors、退回 pending,歌名保留。
- anchor 清單裡標 `≈估` 的是機器估計的句子(ASR 沒直接聽到那句),審核時多留意。
- 「⚠ 重複段」列:目前標的句子在歌裡一字不差地出現好幾次時出現,點選第幾次或按 `r` 循環切換;只改句號、時間不動,人工標的也適用。

## 設計約定(不要改的東西)

- anchor 是**句級**,不做逐字。schema 預留擴充:未來要逐字時在 anchor 加可選 `char` 欄位,向後相容。
- `data/lyrics.json` 由網站的 `src/content/translations/*.md` 生成,是下游產物——歌詞內容有錯要改上游 md,不要直接改這個 JSON。
- 嵌入一律走 YouTube 官方 IFrame(videoId),不下載、不轉載影片內容,版權乾淨。
- 標注工具是內部工具:放在 `public/annotate/`(站上 `/annotate/`),不連進正式導覽、不進 sitemap,`public/robots.txt` 已 Disallow。

## Derek 的工作習慣(協作參考)

直接的技術溝通;偏好可以複製貼上的交付物;迭代式共編而非一次性重寫;明確區分「確定的事實」和「不確定的推測」。有不確定就說,不要編。
