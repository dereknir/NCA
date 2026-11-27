#!/usr/bin/env python3
"""
inject.py — live 三頁重建腳本(資料更新後跑這支,不需要 fable 在場)
用法: python3 inject.py   (data/ 內五份 JSON → ../public/live/{timeline,concerts,footprint}/index.html)
      python3 inject.py --check   只比對、不寫檔; 產出跟 repo 裡的不一樣就 exit 1 (check_sync.py 會跑)
      → 手改 public/live/ 產出檔、沒改範本的修正, 下次排程重產就會被蓋掉, 這裡先擋
"""
import json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
HERE = Path(__file__).parent
PUB = HERE.parent / 'public' / 'live'
D = HERE / 'data'
CHECK = '--check' in sys.argv
_stale = []


def emit(out, text):
    """寫一個產出檔; --check 時只比對, 不一樣就記下來"""
    if CHECK:
        if not out.exists() or out.read_text(encoding='utf-8') != text:
            _stale.append(out.relative_to(HERE.parent))
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding='utf-8')


def load(n): return json.dumps(json.load(open(D / n, encoding='utf-8')), ensure_ascii=False)

news = load('nishina_news_classified.json')
events = load('nishina_live_events.json')
series = load('nishina_appearance_series.json')
tours = load('tour_stops.json')
japan = open(D / 'japan_paths.json', encoding='utf-8').read()
sl = json.load(open(D / 'setlists.json', encoding='utf-8'))
ORDER = ['hatsu', '虎虎', '1999ツアー', '1999限定弾き語りツアー', 'クランベリージャムをかけて',
         'Feeling', 'SUPER COMPLEX', 'MUSICK', 'MUSICK 2', '日々散漫']
setlists = json.dumps([sl.get(k) for k in ORDER], ensure_ascii=False)

JOBS = [
  ('timeline.template.html', 'timeline',
   [('/*__DATA__*/null', news), ('/*__SERIES__*/null', series),
    ('/*__EVENTS__*/null', events), ('/*__TOURS__*/null', tours)]),
  ('concerts.template.html', 'concerts',
   [('/*__DATA__*/null', events), ('/*__SETLISTS__*/null', setlists)]),
  ('footprint.template.html', 'footprint',
   [('/*__DATA__*/null', events), ('/*__SERIES__*/null', series),
    ('/*__JAPAN__*/null', japan), ('/*__TOURS__*/null', tours)]),
]
for tpl, page, blobs in JOBS:
    html = open(HERE / tpl, encoding='utf-8').read()
    for ph, data in blobs:
        assert ph in html, f'{tpl} 缺佔位符 {ph}'
        html = html.replace(ph, data)
    assert '/*__' not in html, f'{page} 有未注入的佔位符!'
    out = PUB / page / 'index.html'
    emit(out, html)
    print(f'✓ {out.relative_to(HERE.parent)}({len(html)//1024}KB)')

# galaxy 的太陽閃焰「N 年前的今天」吃這份輕量池 (fetch /live/events.json 前端計算;
# 沒命中的日子閃焰隱藏)。欄位: d=日期 n=名稱 s=副標(場地)
ev_obj = json.load(open(D / 'nishina_live_events.json', encoding='utf-8'))
tours_obj = json.load(open(D / 'tour_stops.json', encoding='utf-8'))
pool = []
for a in ev_obj['appearance']:
    if a.get('event_date'):
        pool.append({'d': a['event_date'], 'n': a['name'], 's': a.get('venue') or ''})
for t in tours_obj['tours']:
    for st in t['stops']:
        pool.append({'d': st['date'], 'n': t['name'], 's': f"{st['venue']}({st['pref']})"})
pool.sort(key=lambda x: x['d'])
ev_out = PUB / 'events.json'
emit(ev_out, json.dumps(pool, ensure_ascii=False))
print(f'✓ {ev_out.relative_to(HERE.parent)}({len(pool)} 筆事件池)')

# 順手同步「出演場次清單」給 annotator (__live_song 出演演唱的場次 dropdown)
# 這樣 live 資料更新時, annotator 的場次選單自動跟上, 不會漏。
ev_obj = json.load(open(D / 'nishina_live_events.json', encoding='utf-8'))
apps = sorted(ev_obj['appearance'],
              key=lambda x: x.get('event_date') or x.get('date_text') or '', reverse=True)
ann_list = [{'name': a['name'],
             'date': a.get('event_date') or a.get('date_text') or '',
             'news_url': a.get('news_url', '')} for a in apps]
# news 哨兵已收進來、但結構化層還沒登記的出演 (照約定 events 檔等人工解析才動) → 只補進 annotator 選單,
# 不然新公布的場次要等登記完才標得到。名稱/日期取自官方標題「【カテゴリ】 名稱 – YYYY.M.D」, 解析不了的跳過。
_known = {(a.get('news_url') or '').rstrip('/') for a in ev_obj['appearance']} - {''}
_known_nd = {(a['name'], a.get('event_date')) for a in ev_obj['appearance']}
_TITLE = re.compile(r'^【([^】]+)】\s*(.+?)\s*[–—-]\s*(\d{4})\.(\d{1,2})\.(\d{1,2})\s*$')
n_news = 0
for x in json.load(open(D / 'nishina_news_classified.json', encoding='utf-8')):
    if x.get('class') != 'LIVE' or x.get('live_type') != 'APPEARANCE' or x['url'].rstrip('/') in _known:
        continue
    m = _TITLE.match(x['title'].strip())
    if not m:
        continue
    name, date = m.group(2), f'{m.group(3)}-{int(m.group(4)):02d}-{int(m.group(5)):02d}'
    if (name, date) in _known_nd:
        continue
    ann_list.append({'name': name, 'date': date, 'news_url': x['url'], 'unregistered': True})
    n_news += 1
ann_list.sort(key=lambda a: a['date'], reverse=True)
ann_apps = {
    'meta': {'total': len(ann_list), 'unregistered': n_news,
             'source': 'live/data/nishina_live_events.json appearance + news 未登記的出演'},
    'appearances': ann_list,
}
ann_out = HERE.parent / 'public' / 'annotate' / 'appearances.json'
emit(ann_out, json.dumps(ann_apps, ensure_ascii=False, indent=2))
print(f'✓ {ann_out.relative_to(HERE.parent)}({len(ann_list)} 場, 其中 news 未登記 {n_news} 場)')

if CHECK:
    if _stale:
        print('\n✗ 這些產出檔跟範本 + 資料重產的結果不一樣 (手改了產出檔? 修正要改在 live/*.template.html):')
        for p in _stale:
            print(f'  {p}')
        print('  → 改好範本後跑 python3 live/inject.py 重產')
        sys.exit(1)
    print('\n✓ live 產出檔都跟範本一致')
