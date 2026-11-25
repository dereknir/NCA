# 本機助手：annotator 的「🧠 跑模型」

annotator 上按「🧠 跑模型」，就在**正在用的這台電腦**上把還沒跑過模型的 shorts 跑完，結果直接進「🤖 待審」。

- 平常不在背景執行。按下按鈕時瀏覽器開 `nca-runner://start`，系統才叫起 `scripts/local_runner.py`，跑完閒置 10 分鐘自己結束。
- 第一次按，瀏覽器會問要不要開啟「NCA Runner」，勾「一律允許」，之後就不會再問。
- 公司的 Mac（Apple 晶片）和家裡的桌機（NVIDIA）各裝一次。誰按就用誰的 GPU 跑。

## 安裝（每台一次）

前提：repo 裡已經有 `.venv-qwen`（建法見 `annotation/HANDOFF.md`）、有 git、能 push develop。

**Mac**

```bash
bash scripts/runner/install-mac.sh
```

會在 `~/Applications` 放一個沒有視窗的「NCA Runner.app」，系統把 `nca-runner://` 交給它。

**Windows**

在檔案總管雙擊 `scripts\runner\install-windows.cmd`。

只寫目前使用者的登錄（`HKCU\Software\Classes\nca-runner`），不用系統管理員權限。用 `pythonw` 執行，不會跳出黑色視窗。

移除：`bash scripts/runner/uninstall-mac.sh`，或雙擊 `scripts\runner\uninstall-windows.cmd`。

## 按下去之後做了什麼

1. **檢查環境**：git、`.venv-qwen`、Qwen / whisper 套件、ffmpeg、GPU。缺東西時，annotator 上會直接寫缺什麼。
   - 有 Qwen 和 ffmpeg 用 `hybrid` 引擎。只有 whisper 也能跑，只是比較不準。
2. **抓最新的 develop**：放到獨立的工作目錄 `~/.nca-runner/worktree`（git worktree），不會碰正在寫程式的那份。
3. **找出還沒跑的**：`auto_annotate.py --todo` 列出還沒審完、也還沒有機器結果的 shorts。
4. **跑模型**：用 `auto_annotate.py` 跑，跑完自動做同錄音照抄。
5. **寫進待審**：`auto_annotate.py --merge --include-c`，一律寫成 `status=auto`。done、skip，以及我動過的 pending（已經開始打、審核時改了歌、按了「退回手動」）都不動。
6. **推上 develop**：commit 後 push。推不上去時（例如跑的時候在 annotator 存過審核），拿最新的 develop 重新合併再推，最多試 3 次。
7. **重新載入**：annotator 直接從本機助手拿新的佇列、歌詞、機器建議，不用等網站重新部署，再從 GitHub 重拉 anchors（沒存的不會被蓋掉）。

本機助手只接受 annotator 網址（`nca-red.vercel.app`、自己的 Vercel 預覽 `nca-…-dereknirs-projects.vercel.app`、localhost）來的請求，也只做上面這件事。

紀錄在 `~/.nca-runner/runner.log`。失敗時，annotator 上那行字滑過去會顯示最後幾行。

## 📥 今天的 shorts 還沒抓

GitHub 的每日排程常常晚好幾個小時（排 02:17，有時中午才跑）。annotator 打開時，如果今天（台北時間）還沒抓，會出現「📥 立刻抓」。按了會用 ⚙ 裡的 token 觸發 `scrape-shorts.yml`；token 需要 Actions 的寫入權限。抓完再按「🧠 跑模型」，就會包含新的 shorts。

## 測試用的環境變數

| 變數 | 用途 |
|---|---|
| `NCA_RUNNER_REMOTE` | 推到別的 remote，預設 `origin` |
| `NCA_RUNNER_BRANCH` | 用別的分支，預設 `develop` |
| `NCA_RUNNER_NO_PUSH=1` | 只 commit、不推 |
