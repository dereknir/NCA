# 本機助手 (Windows): 註冊 nca-runner:// → annotator 的「🧠 跑模型」按了才叫起 scripts\local_runner.py
# 只寫目前使用者的登錄 (HKCU, 不用系統管理員), 用 pythonw 執行 = 不會跳出黑色視窗, 跑完閒置 10 分鐘自己結束。
# 用法: 在 repo 根目錄雙擊 scripts\runner\install-windows.cmd (或 powershell -ExecutionPolicy Bypass -File scripts\runner\install-windows.ps1)
# 移除: scripts\runner\uninstall-windows.cmd
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Pyw = Join-Path $Repo '.venv-qwen\Scripts\pythonw.exe'
$Runner = Join-Path $Repo 'scripts\local_runner.py'
if (-not (Test-Path $Pyw)) { Write-Host "找不到模型環境 $Pyw — 先照 annotation\HANDOFF.md 建 .venv-qwen"; exit 1 }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host '找不到 git (要在 PATH 裡)'; exit 1 }

$Key = 'HKCU:\Software\Classes\nca-runner'
New-Item -Path $Key -Force | Out-Null
Set-Item -Path $Key -Value 'URL:NCA Runner'
New-ItemProperty -Path $Key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$Key\shell\open\command" -Force | Out-Null
Set-Item -Path "$Key\shell\open\command" -Value ('"{0}" "{1}" "%1"' -f $Pyw, $Runner)
New-Item -Path (Join-Path $HOME '.nca-runner') -ItemType Directory -Force | Out-Null

Write-Host "✓ 裝好了: nca-runner:// → $Runner"
Write-Host '  annotator 按「🧠 跑模型」→ 瀏覽器問要不要開啟 → 勾「一律允許」'
Write-Host "  紀錄: $HOME\.nca-runner\runner.log"
