#!/usr/bin/env python3
"""
YouTube Shorts 爬蟲程式
使用 yt-dlp 獲取指定頻道的 shorts 資料
"""

import subprocess
import sys
import json
from pathlib import Path


def check_ytdlp_installed():
    """檢查 yt-dlp 是否已安裝"""
    try:
        result = subprocess.run(
            ['yt-dlp', '--version'],
            capture_output=True,
            text=True,
            check=True
        )
        print(f"✓ yt-dlp 版本: {result.stdout.strip()}")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("✗ yt-dlp 未安裝")
        return False


def download_shorts_info(channel_url, output_file):
    """
    下載 YouTube 頻道的 shorts 資訊

    Args:
        channel_url: YouTube 頻道 URL
        output_file: 輸出的 JSONL 檔案名稱
    """
    print(f"\n開始爬取: {channel_url}")
    print(f"輸出檔案: {output_file}\n")

    cmd = [
        'yt-dlp',
        '--flat-playlist',
        '--dump-json',
        channel_url
    ]

    try:
        # 執行命令並將輸出寫入檔案
        with open(output_file, 'w', encoding='utf-8') as f:
            process = subprocess.Popen(
                cmd,
                stdout=f,
                stderr=subprocess.PIPE,
                text=True
            )

            # 等待完成
            _, stderr = process.communicate()

            if process.returncode == 0:
                # 計算獲取到的資料筆數
                with open(output_file, 'r', encoding='utf-8') as f:
                    line_count = sum(1 for _ in f)

                print(f"✓ 成功完成！")
                print(f"✓ 共獲取 {line_count} 筆 shorts 資料")
                print(f"✓ 資料已儲存至: {output_file}")

                # 顯示第一筆資料的標題（如果存在）
                if line_count > 0:
                    with open(output_file, 'r', encoding='utf-8') as f:
                        first_line = json.loads(f.readline())
                        print(f"\n範例資料:")
                        print(f"  標題: {first_line.get('title', 'N/A')}")
                        print(f"  影片ID: {first_line.get('id', 'N/A')}")
                        print(f"  URL: {first_line.get('url', 'N/A')}")
            else:
                print(f"✗ 執行失敗")
                if stderr:
                    print(f"錯誤訊息: {stderr}")
                sys.exit(1)

    except Exception as e:
        print(f"✗ 發生錯誤: {e}")
        sys.exit(1)


def main():
    # 預設設定
    default_channel = "https://www.youtube.com/@nishina__official/shorts"
    default_output = "nishina_shorts_raw.jsonl"

    # 可以從命令列參數讀取（如果有提供）
    channel_url = sys.argv[1] if len(sys.argv) > 1 else default_channel
    output_file = sys.argv[2] if len(sys.argv) > 2 else default_output

    print("=" * 60)
    print("YouTube Shorts 爬蟲程式")
    print("=" * 60)

    # 檢查 yt-dlp
    if not check_ytdlp_installed():
        print("\n請先安裝 yt-dlp:")
        print("  pip install yt-dlp")
        sys.exit(1)

    # 執行爬取
    download_shorts_info(channel_url, output_file)

    print("\n" + "=" * 60)
    print("完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()
