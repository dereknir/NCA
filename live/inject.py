#!/usr/bin/env python3
"""
inject.py — live 三頁重建腳本(資料更新後跑這支,不需要 fable 在場)
用法: python3 inject.py   (data/ 內五份 JSON → ../public/live/{timeline,concerts,footprint}/index.html)
"""
import json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
HERE = Path(__file__).parent
PUB = HERE.parent / 'public' / 'live'
D = HERE / 'data'
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
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
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
ev_out.write_text(json.dumps(pool, ensure_ascii=False), encoding='utf-8')
print(f'✓ {ev_out.relative_to(HERE.parent)}({len(pool)} 筆事件池)')

# 順手同步「出演場次清單」給 annotator (__live_song 出演演唱的場次 dropdown)
# 這樣 live 資料更新時, annotator 的場次選單自動跟上, 不會漏。
ev_obj = json.load(open(D / 'nishina_live_events.json', encoding='utf-8'))
apps = sorted(ev_obj['appearance'],
              key=lambda x: x.get('event_date') or x.get('date_text') or '', reverse=True)
ann_apps = {
    'meta': {'total': len(apps), 'source': 'live/data/nishina_live_events.json appearance'},
    'appearances': [{'name': a['name'],
                     'date': a.get('event_date') or a.get('date_text') or '',
                     'news_url': a.get('news_url', '')} for a in apps],
}
ann_out = HERE.parent / 'public' / 'annotate' / 'appearances.json'
ann_out.write_text(json.dumps(ann_apps, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'✓ {ann_out.relative_to(HERE.parent)}({len(apps)} 場)')
