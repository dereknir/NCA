#!/bin/bash
# 移除本機助手 (Mac): 拿掉 NCA Runner.app 跟 nca-runner:// 的註冊。~/.nca-runner (紀錄 + 工作目錄) 留著, 要清自己刪
set -uo pipefail
APP="$HOME/Applications/NCA Runner.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -d "$APP" ] && "$LSREG" -u "$APP" && rm -r "$APP" && echo "✓ 移除 $APP" || echo "沒有裝"
curl -s -X POST -H 'Origin: http://localhost' http://127.0.0.1:8771/quit >/dev/null 2>&1 || true
