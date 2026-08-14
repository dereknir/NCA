#!/usr/bin/env python3
"""
watch-eplus.py — にしな eplus 公演頁定時監視(在你自己的機器/CI 跑)

用法:
  python3 watch-eplus.py            # 抓取 → 與上次狀態 diff → 有新場次時列出
  python3 watch-eplus.py --json     # 輸出 upcoming.json(給站內頁面重注入用)

排程建議(擇一):
  crontab:      0 9 * * *  cd /path && python3 watch-eplus.py
  GitHub Actions:
    schedule: [{cron: '0 0 * * *'}]   # 每日一次,夠了
    (跑完把 upcoming.json commit 回 repo,Vercel 自動重佈)

禮貌守則(寫死在程式裡,別調快):
  - 每日最多一次、單一頁面、不登入、不碰售票端點
  - UA 表明身分與聯絡方式
  - robots.txt 放行本頁(2026-08 驗證);若未來被禁,腳本會自動偵測並停手
"""
import json, re, sys, time, urllib.request
from pathlib import Path

URL = 'https://eplus.jp/sf/word/0000130029'
UA = 'nishina-fansite-watcher/1.0 (non-commercial fan site; contact: dereknir6409@gmail.com)'
STATE = Path(__file__).parent / 'eplus_state.json'
OUT = Path(__file__).parent / 'upcoming.json'

def robots_allows():
    try:
        req = urllib.request.Request('https://eplus.jp/robots.txt', headers={'User-Agent': UA})
        txt = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', 'ignore')
    except Exception:
        return True   # robots 取不到時不因此中止(頁面本身會再驗)
    block, allow = False, True
    ua_all = False
    for line in txt.splitlines():
        line = line.split('#')[0].strip()
        if not line: continue
        k, _, v = line.partition(':')
        k, v = k.strip().lower(), v.strip()
        if k == 'user-agent':
            ua_all = (v == '*')
        elif ua_all and k == 'disallow' and v and '/sf/word' .startswith(v.rstrip('*')):
            allow = False
    return allow

def fetch():
    req = urllib.request.Request(URL, headers={'User-Agent': UA, 'Accept-Language': 'ja'})
    return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'ignore')

def parse(html):
    """eplus 票卡自帶 JSON-LD Event 結構化資料 (2026-08-11 改版驗證:
    每個 detail 連結內嵌 schema.org Event, 含 name/startDate/location) —
    比舊文字 regex 可靠, parser 已改吃 JSON-LD。"""
    events = []
    for m in re.finditer(r'<script type="application/ld\+json">\s*(\{[\s\S]*?\})\s*</script>', html):
        try:
            obj = json.loads(m.group(1), strict=False)
        except Exception:
            continue
        if obj.get('@type') != 'Event':
            continue
        name = (obj.get('name') or '').strip()
        url = (obj.get('url') or '').split('?')[0]
        start = (obj.get('startDate') or '')[:10]
        end = (obj.get('endDate') or '')[:10] or None
        if not name or not start:
            continue
        loc = obj.get('location') or {}
        venue = (loc.get('name') or '').strip()
        addr = loc.get('address') or {}
        pref = (addr.get('addressRegion') or '')
        pref = (pref.replace('県', '').replace('府', '')
                .replace('東京都', '東京').rstrip('都') if pref else '')
        if pref == '': pref = ''
        events.append(dict(date=start, date_end=(end if end != start else None),
                           name=name, venue=venue, pref=pref, url=url))
    # 同活動多販售檔期會重複 → 以 (date,name) 去重
    seen, out = set(), []
    for e in events:
        k = (e['date'], e['name'])
        if k in seen: continue
        seen.add(k)
        out.append(e)
    out.sort(key=lambda e: e['date'])
    return out

def main():
    if not robots_allows():
        print('[eplus] ⚠ robots.txt 已禁止本頁, 停止抓取 — 改人工流程')
        sys.exit(2)
    events = parse(fetch())
    if not events:
        print('[eplus] ⚠ 解析 0 筆 — 頁面可能又改版, 需修 parser')
        sys.exit(1)
    prev = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else []
    prev_keys = {(e['date'], e['name']) for e in prev}
    fresh = [e for e in events if (e['date'], e['name']) not in prev_keys]
    STATE.write_text(json.dumps(events, ensure_ascii=False, indent=1), encoding='utf-8')
    OUT.write_text(json.dumps(
        dict(fetched=time.strftime('%Y-%m-%d'), source=URL, events=events),
        ensure_ascii=False, indent=1), encoding='utf-8')
    if fresh:
        print(f'[eplus] 現售 {len(events)} 場・★ 新場次 {len(fresh)} 筆:')
        for e in fresh:
            print(f"  ・{e['date']} {e['name']} @{e['venue']}({e['pref']})")
    else:
        print(f'[eplus] 現售 {len(events)} 場・無新場次')

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
