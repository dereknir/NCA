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
   [('/*__DATA__*/null', news), ('/*__SERIES__*/null', series)]),
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
