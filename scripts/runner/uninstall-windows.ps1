# 移除本機助手 (Windows): 拿掉 nca-runner:// 的登錄。~\.nca-runner (紀錄 + 工作目錄) 留著, 要清自己刪
$Key = 'HKCU:\Software\Classes\nca-runner'
if (Test-Path $Key) { Remove-Item -Path $Key -Recurse -Force; Write-Host '✓ 移除 nca-runner://' } else { Write-Host '沒有裝' }
try { Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:8771/quit' -Headers @{ Origin = 'http://localhost' } -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {}
