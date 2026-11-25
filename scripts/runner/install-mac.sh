#!/bin/bash
# 本機助手 (Mac): 註冊 nca-runner:// → annotator 的「🧠 跑模型」按了才叫起 scripts/local_runner.py
# 只做一件事: 在 ~/Applications 放一個「NCA Runner.app」(沒有視窗、不常駐), 系統把 nca-runner:// 交給它。
# 用法: bash scripts/runner/install-mac.sh        移除: bash scripts/runner/uninstall-mac.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$REPO/.venv-qwen/bin/python"
RUNNER="$REPO/scripts/local_runner.py"
APP="$HOME/Applications/NCA Runner.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

[ -x "$PY" ] || { echo "找不到模型環境 $PY — 先照 annotation/HANDOFF.md 建 .venv-qwen"; exit 1; }
mkdir -p "$HOME/Applications" "$HOME/.nca-runner"

SRC="$(mktemp -d)/runner.applescript"
cat > "$SRC" <<EOF
on open location theURL
	do shell script "nohup " & quoted form of "$PY" & " " & quoted form of "$RUNNER" & " " & quoted form of theURL & " >> \$HOME/.nca-runner/launch.log 2>&1 &"
end open location
on run
	do shell script "nohup " & quoted form of "$PY" & " " & quoted form of "$RUNNER" & " >> \$HOME/.nca-runner/launch.log 2>&1 &"
end run
EOF

[ -d "$APP" ] && rm -r "$APP"
osacompile -o "$APP" "$SRC"
PL="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Delete :CFBundleIdentifier" "$PL" 2>/dev/null || true
$PB -c "Add :CFBundleIdentifier string com.derekkk.nca-runner" "$PL"
$PB -c "Add :LSUIElement bool true" "$PL"                       # 不出現在 Dock
$PB -c "Add :CFBundleURLTypes array" "$PL"
$PB -c "Add :CFBundleURLTypes:0 dict" "$PL"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLName string NCA Runner" "$PL"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PL"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string nca-runner" "$PL"
"$LSREG" -f "$APP"

echo "✓ 裝好了: $APP"
echo "  annotator 按「🧠 跑模型」→ 瀏覽器問要不要開啟 NCA Runner → 勾「一律允許」"
echo "  紀錄: ~/.nca-runner/runner.log"
