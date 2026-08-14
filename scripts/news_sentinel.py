#!/usr/bin/env python3
"""
news_sentinel.py — 官方 news RSS 哨兵 (每日 1 GET, 走正規 feed 管道)

合法性: nishina247.jp robots.txt 僅禁 /wp-admin/ (2026-08-11 驗證),
且官方在 robots 廣播 sitemap/RSS — feed 本就是給機器訂閱的管道。

流程:
  fetch https://nishina247.jp/news/feed/ (最新 ~10 條)
  → 對照 live/data/nishina_news_classified.json 找新條目
  → 依官方標題【カテゴリ】前綴自動分類 (與既有資料同口徑)
  → 新條目插到 JSON 最前 (年表層自動更新)
  → LIVE 類新條目在報告中標記「events/tours 待補」(結構化層等人工解析)

報告寫到 $REPORT_PATH (給日報信整合), 無新條目也寫一行狀態。
"""
import io
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
NEWS_FILE = ROOT / "live" / "data" / "nishina_news_classified.json"
FEED_URL = "https://nishina247.jp/news/feed/"
UA = "nishina-fansite-sentinel/1.0 (non-commercial fan site; contact: dereknir6409@gmail.com)"
JST = timezone(timedelta(hours=9))

# 分類規則 (與既有 119 條資料同口徑; 順序即優先序, 先命中先贏)
RULES = [
    ("GOODS", None, ["グッズ", "EC", "ストア", "受注"]),
    ("COLLAB", None, ["feat", "コラボ", "参加", "コーラス", "ゲスト", "ビジュアルモデル"]),
    ("TIEUP", None, ["主題歌", "CM", "ドラマ", "アニメ", "タイアップ",
                     "エンディング", "オープニング", "テーマ", "ANN"]),
    ("LIVE", "ONEMAN", ["ワンマン", "ツアー", "弾き語り", "公演"]),
    ("LIVE", "APPEARANCE", ["フェス", "イベント", "学園祭", "対バン", "振替", "中止", "出演", "祭"]),
    ("RELEASE", None, ["リリース", "新曲", "アルバム", "シングル", "配信", "EP", "MV"]),
]


def classify(title: str):
    m = re.match(r"^【([^】]+)】", title)
    cat = m.group(1).strip() if m else "(無分類)"
    hay = cat if m else title
    for cls, live_type, kws in RULES:
        if any(k in hay for k in kws):
            return cat, cls, live_type
    return cat, "OTHER", None


def canon(url: str) -> str:
    return url.rstrip("/")


def main():
    report: list[str] = []
    news = json.loads(NEWS_FILE.read_text(encoding="utf-8"))
    known = {canon(n["url"]) for n in news}

    req = urllib.request.Request(FEED_URL, headers={
        "User-Agent": UA, "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5"})
    xml = urllib.request.urlopen(req, timeout=30).read()
    root = ET.fromstring(xml)
    items = root.findall(".//item")
    if not items:
        report.append("[news] ⚠ feed 解析到 0 條 — 結構可能改版, 請人工檢查")
        emit(report, exit_code=1)
        return

    fresh = []
    for it in items:
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate")
        if not title or not link or canon(link) in known:
            continue
        try:
            d = parsedate_to_datetime(pub).astimezone(JST)
            date = f"{d.year}.{d.month:02d}.{d.day:02d}"
        except Exception:
            date = ""
        cat, cls, live_type = classify(title)
        entry = {"date": date, "url": canon(link) + "/", "title": title,
                 "category": cat, "source": "official_news", "class": cls}
        if live_type:
            entry["live_type"] = live_type
        fresh.append(entry)

    if not fresh:
        report.append(f"[news] 無新條目 (feed {len(items)} 條均已入庫)")
        emit(report)
        return

    # feed 由新到舊; 插到 JSON 最前並保持 feed 順序
    news = fresh + news
    NEWS_FILE.write_text(json.dumps(news, ensure_ascii=False, indent=1), encoding="utf-8")

    report.append(f"[news] 新增 {len(fresh)} 條 (年表已自動更新):")
    n_live = 0
    for e in fresh:
        lt = f"/{e['live_type']}" if e.get("live_type") else ""
        report.append(f"  ・{e['date']} {e['title'][:52]} → {e['class']}{lt}")
        if e["class"] == "LIVE":
            n_live += 1
    if n_live:
        report.append(f"  ⚠ 內含 {n_live} 條 LIVE 類 — events/tours 尚未登記, 場地/日期請人工補 (貼內文給 Claude Code 即可)")
    if any(e["class"] == "OTHER" for e in fresh):
        report.append("  ⚠ 有 OTHER 類 (機器分不出) — 有空時人工校正 class")
    emit(report)


def emit(lines, exit_code=0):
    text = "\n".join(lines)
    print(text)
    rp = os.environ.get("REPORT_PATH")
    if rp:
        Path(rp).write_text(text + "\n", encoding="utf-8")
    sys.exit(exit_code)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        # 失敗也要自我報告進日報 — 別讓死因被通用訊息吞掉
        emit([f"[news] ⚠ 執行失敗: {type(exc).__name__}: {str(exc)[:120]}"], exit_code=1)
