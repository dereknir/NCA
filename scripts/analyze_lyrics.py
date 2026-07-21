#!/usr/bin/env python3
"""
analyze_lyrics.py — にしな歌詞宇宙 資料管線
lyrics.json → fugashi(unidic) 斷詞 → 聚合統計 → src/data/lyric_universe.json
                                              → public/lyric-universe/index.html
離線一次性腳本:歌詞更新時重跑,產物 JSON 進 repo,不掛在 astro build 裡。
用法: python scripts/analyze_lyrics.py   (從 repo root 執行)
"""
import json, re, sys, math
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
import fugashi

ROOT = Path(__file__).parent.parent
LYRICS_PATH = ROOT / 'data' / 'lyrics.json'
TEMPLATE_PATH = ROOT / 'scripts' / 'lyric-universe.template.html'
OUT_JSON = ROOT / 'src' / 'data' / 'lyric_universe.json'
OUT_HTML = ROOT / 'public' / 'lyric-universe' / 'index.html'

# 只分析にしな 本人的歌 (YOASOBI 客串 / 未來若有其他外部合作皆自動排除)
ARTIST_ALLOWLIST = {'にしな'}

tagger = fugashi.Tagger()

# ---------- 策展辭典(站長可自由增修;依 2026-07 真實詞頻初版) ----------
IMAGERY = {
    '夜':   ['夜', '夜中', '真夜中', '深夜', '今夜', '夜明け'],
    '月':   ['月', '月明かり', '三日月', '満月'],
    '星':   ['星', '星空', '流れ星', '星座'],
    '空':   ['空', '青空', '夜空', '天'],
    '水・海': ['海', '波', '水', '雨', '雫', '泳ぐ'],
    '花':   ['花', '花びら', '桜', '花束'],
    '夢':   ['夢'],
    '光':   ['光', '灯り', '明かり', '灯', '輝く'],
    '煙':   ['煙', '煙草', 'タバコ', 'スモーク'],
    '宇宙': ['宇宙', '地球', '惑星', '銀河', 'ロケット'],
    '果実': ['リンゴ', '林檎', 'ピーチ', '桃', '李', 'フルーツ', '果汁', 'ジャム', 'クランベリー', 'ベリー'],
    '愛・恋': ['愛', '恋', '愛す', '愛しい'],
    '鼓動・体温': ['心', '胸', '鼓動', '体温', '心臓'],
}
PRONOUNS = {'私': ['私'], '君': ['君'], '僕': ['僕'], 'あなた': ['貴方'], 'おまえ': ['御前']}
COLORS = {
    '青': '#3b82d6', '蒼': '#4a7bbf', '藍': '#274b8f', '群青': '#2b4a9b', '水色': '#7cc4e8',
    '白': '#e8e8ee', '黒': '#2a2d38', '赤': '#d64545', '茜': '#b93a32', '紅': '#c23b52',
    '桃色': '#f2a6c0', 'ピンク': '#f2a6c0', 'オレンジ': '#ef8a3c', '橙': '#ef8a3c',
    '緑': '#3f9e6e', '黄色': '#e8c94a', '金': '#d4af37', '銀': '#b9c2cc',
    '紫': '#8a63c9', '灰': '#9aa0a8', '虹': '#7cc4e8',
}
COLOR_ALIAS = {'青い': '青', '白い': '白', '黒い': '黒', '赤い': '赤', '蒼い': '蒼', '黄色い': '黄色'}
# 網絡圖停用詞(語法化名詞/感嘆/外文碎片以 CJK 過濾另行處理)
STOP = {'事', '物', '時', '今', '中', '侭', '本当', '気', '人', '日', '今日', '明日', '振り',
        '様', '方', '訳', '筈', '所', '為', '奴', '之', '達'}

CJK = re.compile(r'[ぁ-んァ-ヶ一-龯]')

def norm_lemma(w):
    lem = w.feature.lemma or w.surface
    if re.search(r'-[A-Za-z][A-Za-z ]*$', lem):
        lem = lem.rsplit('-', 1)[0]
    lem = lem.replace('-代名詞', '').replace('-外国', '')
    return lem

def kana_ratio(text):
    kana = len(re.findall(r'[ぁ-んァ-ヶ]', text))
    cjk = len(CJK.findall(text))
    return kana / cjk if cjk else 0

# ---------- 讀語料 ----------
data = json.load(open(LYRICS_PATH, encoding='utf-8'))
songs = [
    s for s in data['songs']
    if not s.get('instrumental') and s.get('artist') in ARTIST_ALLOWLIST
]
print(f'analyzing {len(songs)} songs (filtered artist ∈ {ARTIST_ALLOWLIST}, non-instrumental)')
albums = sorted({(s['album'], s['album_year']) for s in songs}, key=lambda a: (str(a[1]), a[0]))
album_order = [a[0] for a in albums]
album_lines = Counter()

# line 紀錄: (song_id, song_title, index, ja, zh, album, lemma集合)
records = []
for s in songs:
    for ln in s['lyric_lines']:
        if not ln.get('ja'):
            continue
        lemmas, pron_hits = [], []
        for w in tagger(ln['ja']):
            p1, p2 = w.feature.pos1, w.feature.pos2
            lem = norm_lemma(w)
            if p1 == '代名詞':
                pron_hits.append(lem)
            elif p1 == '名詞' and p2 in ('普通名詞', '固有名詞'):
                lemmas.append(lem)
            elif p1 in ('動詞', '形容詞') and p2 != '非自立可能':
                lemmas.append(lem)
        records.append(dict(song=s['id'], title=s['title'], idx=ln['index'], ja=ln['ja'],
                            zh=ln.get('zh', ''), album=s['album'], lemmas=lemmas, prons=pron_hits))
        album_lines[s['album']] += 1

def ref(r):  # 引用永遠單句尺度
    return dict(song=r['song'], title=r['title'], idx=r['idx'], ja=r['ja'], zh=r['zh'])

# ---------- 1. 意象 × 專輯 ----------
imagery_out = []
for group, keys in IMAGERY.items():
    keyset = set(keys)
    per_album, refs, total = Counter(), [], 0
    seen_ja = set()   # 例句 dedupe: 同一段文字只留一次 (副歌反覆會撞)
    for r in records:
        hits = sum(1 for l in r['lemmas'] if l in keyset)
        if hits:
            per_album[r['album']] += hits
            total += hits
            if len(refs) < 5 and r['ja'] not in seen_ja:
                refs.append(ref(r))
                seen_ja.add(r['ja'])
    if total == 0:
        continue
    imagery_out.append(dict(
        group=group, total=total,
        perAlbum=[dict(album=a, count=per_album.get(a, 0),
                       density=round(per_album.get(a, 0) / album_lines[a] * 100, 2))
                  for a in album_order],
        refs=refs))
imagery_out.sort(key=lambda g: -g['total'])

# ---------- 2. 人稱代名詞 ----------
pron_out = []
for label, keys in PRONOUNS.items():
    keyset = set(keys)
    per_album, total = Counter(), 0
    for r in records:
        hits = sum(1 for p in r['prons'] if p in keyset)
        per_album[r['album']] += hits
        total += hits
    if total:
        pron_out.append(dict(label=label, total=total,
                             perAlbum=[dict(album=a, count=per_album.get(a, 0),
                                            density=round(per_album.get(a, 0) / album_lines[a] * 100, 2))
                                       for a in album_order]))
pron_out.sort(key=lambda g: -g['total'])

# ---------- 3. 色彩詞 ----------
color_counter, color_refs = Counter(), defaultdict(list)
color_seen = defaultdict(set)   # 例句 dedupe
for r in records:
    text_lemmas = set(r['lemmas'])
    for l in list(text_lemmas):
        cname = COLOR_ALIAS.get(l, l if l in COLORS else None)
        if cname:
            color_counter[cname] += 1
            if len(color_refs[cname]) < 4 and r['ja'] not in color_seen[cname]:
                color_refs[cname].append(ref(r))
                color_seen[cname].add(r['ja'])
colors_out = [dict(name=n, hex=COLORS[n], count=c, refs=color_refs[n])
              for n, c in color_counter.most_common()]

# ---------- 4. 專輯指紋(TF-IDF + 文體統計) ----------
docs = {a: Counter() for a in album_order}
album_chars = Counter(); album_kana = Counter()
for r in records:
    for l in r['lemmas']:
        if CJK.search(l) and l not in STOP:
            docs[r['album']][l] += 1
    album_chars[r['album']] += len(CJK.findall(r['ja']))
    album_kana[r['album']] += len(re.findall(r'[ぁ-んァ-ヶ]', r['ja']))
N = len(album_order)
df = Counter()
for a in album_order:
    for term in docs[a]:
        df[term] += 1
fingerprints = []
for a in album_order:
    tfidf = {t: c * math.log((N + 1) / (df[t] + 0.5)) for t, c in docs[a].items() if c >= 2}
    top = sorted(tfidf.items(), key=lambda x: -x[1])[:8]
    fingerprints.append(dict(
        album=a, year=next(y for al, y in albums if al == a),
        songs=sum(1 for s in songs if s['album'] == a), lines=album_lines[a],
        kanaRatio=round(album_kana[a] / album_chars[a], 3) if album_chars[a] else 0,
        avgLineChars=round(album_chars[a] / album_lines[a], 1),
        topTerms=[dict(term=t, score=round(sc, 1)) for t, sc in top]))

# ---------- 5. 共現網絡 ----------
freq = Counter()
for r in records:
    for l in set(r['lemmas']):
        if CJK.search(l) and l not in STOP:
            freq[l] += 1
node_vocab = [w for w, _ in freq.most_common(40)]
node_set = set(node_vocab)
edges = Counter()
node_refs = defaultdict(list)
node_seen = defaultdict(set)   # 例句 dedupe
for i, r in enumerate(records):
    window = set(r['lemmas'])
    if i + 1 < len(records) and records[i + 1]['song'] == r['song']:
        window |= set(records[i + 1]['lemmas'])
    hits = sorted((window & node_set))
    for l in set(r['lemmas']) & node_set:
        if len(node_refs[l]) < 6 and r['ja'] not in node_seen[l]:
            node_refs[l].append(ref(r))
            node_seen[l].add(r['ja'])
    for a, b in combinations(hits, 2):
        edges[(a, b)] += 1
network = dict(
    nodes=[dict(id=w, count=freq[w], refs=node_refs[w]) for w in node_vocab],
    links=[dict(source=a, target=b, weight=wt) for (a, b), wt in edges.items() if wt >= 3])

# ---------- 輸出 ----------
out = dict(
    meta=dict(songs=len(songs), lines=len(records),
              albums=[dict(name=a, year=y) for a, y in albums],
              generated='analyze_lyrics.py', note='統計皆為描述性事實;引用一律單句'),
    imagery=imagery_out, pronouns=pron_out, colors=colors_out,
    fingerprints=fingerprints, network=network)

OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
json.dump(out, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"✓ {OUT_JSON.relative_to(ROOT)}  意象組 {len(imagery_out)} / 色彩 {len(colors_out)} / "
      f"節點 {len(network['nodes'])} / 邊 {len(network['links'])}")

# 注入 HTML 模板 → public/ 靜態頁
if TEMPLATE_PATH.exists():
    tpl = open(TEMPLATE_PATH, encoding='utf-8').read()
    html = tpl.replace('/*__DATA__*/null', json.dumps(out, ensure_ascii=False))
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    open(OUT_HTML, 'w', encoding='utf-8').write(html)
    print(f"✓ {OUT_HTML.relative_to(ROOT)} (資料已內嵌)")
else:
    print(f"(無模板 {TEMPLATE_PATH}, 略過 HTML 注入)")
