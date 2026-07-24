#!/usr/bin/env python3
"""
build_kwic.py — KWIC concordance 索引
lyrics.json → kwic_index.json(行表 + lemma 倒排索引含字元偏移)+ 注入 kwic.html

特性:
- lemma 搜尋:搜「溶ける」命中「溶けて/溶けた」等全部活用形
- 行去重:同曲同 ja 行唯一化,重複次數存為 n(前端顯示 ×n 徽章)
- 偏移:每筆 posting 帶 (lineId, start, end),前端據此切三欄對齊
- 索引詞性:名詞/動詞/形容詞/副詞/代名詞(助詞助動詞不索引,防膨脹)

用法: python build_kwic.py [lyrics.json]
"""
import json, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path
import fugashi

ROOT = Path(__file__).parent.parent
LYRICS_PATH = ROOT / 'data' / 'lyrics.json'
TEMPLATE_PATH = ROOT / 'scripts' / 'kwic.template.html'
OUT_JSON = ROOT / 'src' / 'data' / 'kwic_index.json'
OUT_HTML = ROOT / 'public' / 'kwic' / 'index.html'

# 同 analyze_lyrics.py: 只索引にしな 本人的歌 (YOASOBI 客串等自動排除)
ARTIST_ALLOWLIST = {'にしな'}

INDEX_POS = {'名詞', '動詞', '形容詞', '副詞', '代名詞'}
tagger = fugashi.Tagger()


def norm_lemma(w):
    lem = w.feature.lemma or w.surface
    if re.search(r'-[A-Za-z][A-Za-z ]*$', lem):
        lem = lem.rsplit('-', 1)[0]
    return lem.replace('-代名詞', '').replace('-外国', '')


def tokenize_with_offsets(ja: str):
    """回傳 [(surface, lemma, pos1, start, end)];以游標掃描補回偏移"""
    out, cur = [], 0
    for w in tagger(ja):
        s = w.surface
        start = ja.find(s, cur)
        if start < 0:          # 理論上不會,防禦
            continue
        end = start + len(s)
        out.append((s, norm_lemma(w), w.feature.pos1, start, end))
        cur = end
    return out


data = json.load(open(LYRICS_PATH, encoding='utf-8'))
songs = [
    s for s in data['songs']
    if not s.get('instrumental')
    and not s.get('exclude_from_lyric_analysis')
    and s.get('artist') in ARTIST_ALLOWLIST
]
print(f'indexing {len(songs)} songs (filtered artist ∈ {ARTIST_ALLOWLIST}, non-instrumental)', file=sys.stderr)

lines, postings = [], defaultdict(list)
vocab_lines = Counter()                    # lemma -> 出現行數(unique)
forms = defaultdict(Counter)               # lemma -> surface 分布
dup = 0

for s in songs:
    seen = {}
    for ln in s['lyric_lines']:
        ja = ln.get('ja')
        if not ja:
            continue
        key = unicodedata.normalize('NFKC', ja).replace(' ', '').replace('\u3000', '')
        if key in seen:                     # 重複行:計數,不重索引
            lines[seen[key]]['n'] += 1
            dup += 1
            continue
        line_id = len(lines)
        seen[key] = line_id
        lines.append(dict(id=line_id, song=s['id'], title=s['title'],
                          idx=ln['index'], ja=ja, zh=ln.get('zh', ''), n=1))
        hit_lemmas = set()
        for surf, lem, pos1, st, en in tokenize_with_offsets(ja):
            if pos1 not in INDEX_POS:
                continue
            postings[lem].append([line_id, st, en])
            forms[lem][surf] += 1
            hit_lemmas.add(lem)
        for lem in hit_lemmas:
            vocab_lines[lem] += 1

vocab = [dict(lemma=l, lines=c, forms=dict(forms[l].most_common(6)))
         for l, c in vocab_lines.most_common()]

out = dict(
    meta=dict(lines=len(lines), dupCollapsed=dup, lemmas=len(vocab),
              indexPos=sorted(INDEX_POS), dedup='同曲同 ja 行唯一化,重複計於 n'),
    lines=lines, postings=dict(postings), vocab=vocab)

OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
json.dump(out, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False,
          separators=(',', ':'))
size_kb = len(json.dumps(out, ensure_ascii=False)) / 1024
print(f"✓ {OUT_JSON.relative_to(ROOT)}  行 {len(lines)}(收合重複 {dup}) / lemma {len(vocab)} / {size_kb:.0f}KB",
      file=sys.stderr)

if TEMPLATE_PATH.exists():
    tpl = open(TEMPLATE_PATH, encoding='utf-8').read()
    html = tpl.replace('/*__DATA__*/null', json.dumps(out, ensure_ascii=False))
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    open(OUT_HTML, 'w', encoding='utf-8').write(html)
    print(f"✓ {OUT_HTML.relative_to(ROOT)} (索引已內嵌)", file=sys.stderr)
else:
    print(f"(無模板 {TEMPLATE_PATH}, 略過 HTML 注入)", file=sys.stderr)
