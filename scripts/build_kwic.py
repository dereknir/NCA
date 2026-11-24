#!/usr/bin/env python3
"""
build_kwic.py — KWIC concordance 索引
lyrics.json → kwic_index.json(行表 + lemma 倒排索引含字元偏移)+ 注入 kwic.html

特性:
- lemma 搜尋:搜「溶ける」命中「溶けて/溶けた」等全部活用形
- 行去重:同曲同 ja 行唯一化,重複次數存為 n(前端顯示 ×n 徽章)
- 偏移:每筆 posting 帶 (lineId, start, end),前端據此切三欄對齊
- 索引詞性:名詞/動詞/形容詞/副詞/代名詞(助詞助動詞不索引,防膨脹)
- 每個詞另記讀音 (read, 平假名)、詞性 (pos)、顯示用的字 (head): 翻譯頁點歌詞裡的詞會跳出小卡, 用這幾個欄位

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

# 同 analyze_lyrics.py: 只索引にしな 本人的歌 (其他歌手的歌自動排除)
ARTIST_ALLOWLIST = {'にしな'}

INDEX_POS = {'名詞', '動詞', '形容詞', '副詞', '代名詞'}
tagger = fugashi.Tagger()


def norm_lemma(w):
    lem = w.feature.lemma or w.surface
    if re.search(r'-[A-Za-z][A-Za-z ]*$', lem):
        lem = lem.rsplit('-', 1)[0]
    return lem.replace('-代名詞', '').replace('-外国', '')


def kata2hira(s):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in (s or ''))


def tokenize_with_offsets(ja: str):
    """回傳 [(surface, lemma, pos1, start, end, 原形讀音)];以游標掃描補回偏移"""
    out, cur = [], 0
    for w in tagger(ja):
        s = w.surface
        start = ja.find(s, cur)
        if start < 0:          # 理論上不會,防禦
            continue
        end = start + len(s)
        lem = norm_lemma(w)
        # 讀音: 歌詞裡就寫成原形的, 用它實際的讀法 (私 → わたし); 不然用字典原形的讀音 (lForm)
        rd = getattr(w.feature, 'kana', None) if s == lem else getattr(w.feature, 'lForm', None)
        out.append((s, lem, w.feature.pos1, start, end, kata2hira(rd or '')))
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
lemma_read, lemma_pos = {}, {}             # lemma -> 原形讀音 / 詞性 (第一次看到的)
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
        for surf, lem, pos1, st, en, rd in tokenize_with_offsets(ja):
            if pos1 not in INDEX_POS:
                continue
            if surf == lem or lem not in lemma_read:   # 寫成原形的讀法優先
                lemma_read[lem] = rd if surf == lem or lem not in lemma_read else lemma_read[lem]
            lemma_pos.setdefault(lem, pos1)
            postings[lem].append([line_id, st, en])
            forms[lem][surf] += 1
            hit_lemmas.add(lem)
        for lem in hit_lemmas:
            vocab_lines[lem] += 1

# 字典 (unidic-lite) 給的讀音跟歌裡唱的不一樣的幾個: 私 → わたくし、言う → ゆう、音 → おん …
READ_FIX = {'私': 'わたし', '言う': 'いう', '音': 'おと', '体': 'からだ', '明日': 'あした', '何': 'なに'}
lemma_read.update({k: v for k, v in READ_FIX.items() if k in lemma_read})


def head_of(lem):
    """顯示用的字: 字典的原形有時是很少人寫的漢字 (為る、居る、仕舞う), 歌詞裡從沒寫過那個漢字的話就用讀音"""
    kanji = [c for c in lem if '\u4e00' <= c <= '\u9fff']
    rd = lemma_read.get(lem, '')
    if kanji and rd and not any(k in f for f in forms[lem] for k in kanji):
        return rd
    return lem


vocab = []
for l, c in sorted(vocab_lines.items(), key=lambda x: (-x[1], x[0])):   # 同次數照詞排 (集合的順序每次跑都不同)
    head, rd = head_of(l), lemma_read.get(l, '')
    vocab.append(dict(lemma=l, lines=c, forms=dict(forms[l].most_common(6)),
                      head=head, read=rd if rd and rd != head else '', pos=lemma_pos.get(l, '')))

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
    html = tpl.replace('/*__DATA__*/null', json.dumps(out, ensure_ascii=False).replace('</', '<\\/'))  # 資料裡有 </script> 也不會提早把 script 關掉
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    open(OUT_HTML, 'w', encoding='utf-8').write(html)
    print(f"✓ {OUT_HTML.relative_to(ROOT)} (索引已內嵌)", file=sys.stderr)
else:
    print(f"(無模板 {TEMPLATE_PATH}, 略過 HTML 注入)", file=sys.stderr)
