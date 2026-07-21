#!/usr/bin/env python3
"""
embed_star_map.py — にしな歌詞星圖 管線
lyrics.json → 句子向量 → UMAP 2D → KMeans 星座 → c-TF-IDF 星座命名
           → star_map.json(+ vectors_q8.json 供未來語意搜尋)→ 注入 star-map.html

Encoder 可插拔(--encoder):
  e5     正式版:intfloat/multilingual-e5-small(384 維,多語)。
         選它的理由:跨語檢索強——歌詞以日文嵌入、之後語意搜尋可用中文查詢,
         同一向量空間直接複用,是「星圖+語意搜尋+處方箋議題」三合一的地基。
  tfidf  佔位驗證版:char n-gram TF-IDF + SVD128。無需下載模型,
         用於端到端驗證管線與頁面;語意品質不及 e5,正式上線務必換 e5。

正式版執行(Derek 本機):
  pip install sentence-transformers umap-learn scikit-learn fugashi unidic-lite
  python embed_star_map.py lyrics.json --encoder e5
"""
import argparse, json, math, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
import fugashi

ROOT = Path(__file__).parent.parent
LYRICS_PATH = ROOT / 'data' / 'lyrics.json'
TEMPLATE_PATH = ROOT / 'scripts' / 'star-map.template.html'
OUT_JSON = ROOT / 'src' / 'data' / 'star_map.json'
OUT_VEC = ROOT / 'src' / 'data' / 'vectors_q8.json'
OUT_HTML = ROOT / 'public' / 'star-map' / 'index.html'

# 同 analyze_lyrics.py / build_kwic.py: 排除 yoasobi 等外部客串
ARTIST_ALLOWLIST = {'にしな'}

# E5 家族最大版 (Derek 指定「最厲害的」);跨語言 retrieval 表現最好
E5_MODEL = 'intfloat/multilingual-e5-large'

ap = argparse.ArgumentParser()
ap.add_argument('lyrics', nargs='?', default=str(LYRICS_PATH))
ap.add_argument('--encoder', choices=['e5', 'tfidf'], default='e5')
ap.add_argument('--k', type=int, default=12, help='星座數(KMeans)')
ap.add_argument('--emit-vectors', action='store_true', help='輸出 int8 向量供語意搜尋')
args = ap.parse_args()

tagger = fugashi.Tagger()
CJK = re.compile(r'[ぁ-んァ-ヶ一-龯]')
STOP = {'事', '物', '時', '今', '中', '侭', '本当', '気', '人', '日', '様', '方', '訳', '所', '為'}


def content_lemmas(ja):
    out = []
    for w in tagger(ja):
        p1, p2 = w.feature.pos1, w.feature.pos2
        lem = (w.feature.lemma or w.surface)
        if re.search(r'-[A-Za-z][A-Za-z ]*$', lem):
            lem = lem.rsplit('-', 1)[0]
        lem = lem.replace('-代名詞', '').replace('-外国', '')
        if (p1 == '名詞' and p2 in ('普通名詞', '固有名詞')) or \
           (p1 in ('動詞', '形容詞') and p2 != '非自立可能'):
            if CJK.search(lem) and lem not in STOP:
                out.append(lem)
    return out


# ---------- 語料(去重,重複計於 n) ----------
data = json.load(open(args.lyrics, encoding='utf-8'))
lines = []
for s in data['songs']:
    if s.get('instrumental'):
        continue
    if s.get('artist') not in ARTIST_ALLOWLIST:
        continue
    seen = {}
    for ln in s['lyric_lines']:
        ja = ln.get('ja')
        if not ja:
            continue
        key = unicodedata.normalize('NFKC', ja).replace(' ', '').replace('\u3000', '')
        if key in seen:
            lines[seen[key]]['n'] += 1
            continue
        seen[key] = len(lines)
        lines.append(dict(song=s['id'], title=s['title'], album=s['album'],
                          idx=ln['index'], ja=ja, zh=ln.get('zh', ''), n=1))
print(f"語料:{len(lines)} unique 行", file=sys.stderr)

# ---------- 編碼 ----------
if args.encoder == 'e5':
    from sentence_transformers import SentenceTransformer
    print(f"loading {E5_MODEL} (first run downloads ~2.2GB, cached thereafter)", file=sys.stderr)
    model = SentenceTransformer(E5_MODEL)
    # E5 慣例:文件加 "passage: " 前綴(查詢端之後用 "query: ")
    emb = model.encode([f"passage: {l['ja']}" for l in lines],
                       normalize_embeddings=True, show_progress_bar=True)
    emb = np.asarray(emb, dtype=np.float32)
else:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.decomposition import TruncatedSVD
    from sklearn.preprocessing import normalize
    vec = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 3), min_df=2)
    X = vec.fit_transform([l['ja'] for l in lines])
    emb = TruncatedSVD(n_components=128, random_state=42).fit_transform(X)
    emb = normalize(emb).astype(np.float32)
    print("⚠ tfidf 佔位編碼器:僅供管線/頁面驗證,正式版請 --encoder e5", file=sys.stderr)
print(f"向量:{emb.shape}", file=sys.stderr)

# ---------- 降維(語意空間分群、2D 只管顯示) ----------
try:
    from umap import UMAP
    xy = UMAP(n_neighbors=15, min_dist=0.08, metric='cosine',
              random_state=42).fit_transform(emb)
    proj = 'umap(n_neighbors=15,min_dist=0.08,cosine,seed=42)'
except ImportError:
    from sklearn.decomposition import TruncatedSVD
    xy = TruncatedSVD(n_components=2, random_state=42).fit_transform(emb)
    proj = 'svd2(umap 未安裝的退路)'
xy = xy - xy.min(axis=0)
xy = xy / xy.max(axis=0) * 1000.0

# ---------- 星座(KMeans 於高維語意空間) ----------
from sklearn.cluster import KMeans
km = KMeans(n_clusters=args.k, n_init=10, random_state=42).fit(emb)
labels = km.labels_

# c-TF-IDF 命名草稿(站長之後改名)
tf = [Counter() for _ in range(args.k)]
for l, c in zip(lines, labels):
    tf[c].update(content_lemmas(l['ja']))
df = Counter()
for c in range(args.k):
    for t in tf[c]:
        df[t] += 1
clusters = []
for c in range(args.k):
    scored = {t: n * math.log(args.k / df[t] + 1e-9) if df[t] else 0 for t, n in tf[c].items()}
    top = [t for t, _ in sorted(scored.items(), key=lambda x: -x[1])[:3]]
    clusters.append(dict(id=c, autoLabel='・'.join(top) or f'星座{c}',
                         size=int((labels == c).sum())))

# ---------- 鄰居 sanity(run 即自檢) ----------
rng = np.random.default_rng(7)
print("\n=== 鄰居抽查(語意空間 cosine,自行目檢是否合理) ===", file=sys.stderr)
for i in rng.choice(len(lines), 3, replace=False):
    sims = emb @ emb[i]
    nn = np.argsort(-sims)[1:4]
    print(f"◆ {lines[i]['ja']}", file=sys.stderr)
    for j in nn:
        print(f"    {sims[j]:.3f}  {lines[j]['ja']}  [{lines[j]['title']}]", file=sys.stderr)

# ---------- 輸出 ----------
out = dict(
    meta=dict(encoder=args.encoder, dim=int(emb.shape[1]), projection=proj,
              k=args.k, lines=len(lines),
              note='星座為語意分群;autoLabel 為 c-TF-IDF 草稿,正式名稱由站長策展'),
    clusters=clusters,
    points=[dict(id=i, song=l['song'], title=l['title'], album=l['album'], idx=l['idx'],
                 ja=l['ja'], zh=l['zh'], n=l['n'],
                 x=round(float(xy[i, 0]), 1), y=round(float(xy[i, 1]), 1), c=int(labels[i]))
            for i, l in enumerate(lines)])
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
json.dump(out, open(OUT_JSON, 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print(f"\n✓ {OUT_JSON.relative_to(ROOT)}({len(lines)} 點 / {args.k} 星座)", file=sys.stderr)

if args.emit_vectors or args.encoder == 'e5':
    q = np.clip(np.round(emb * 127), -127, 127).astype(np.int8)
    json.dump(dict(dim=int(emb.shape[1]), scale=127, encoder=args.encoder,
                   note='cosine 用:int8/127 後點積即近似相似度',
                   vectors=[r.tolist() for r in q]),
              open(OUT_VEC, 'w', encoding='utf-8'), separators=(',', ':'))
    print(f"✓ {OUT_VEC.relative_to(ROOT)}(語意搜尋索引, int8)", file=sys.stderr)

if TEMPLATE_PATH.exists():
    tpl = open(TEMPLATE_PATH, encoding='utf-8').read()
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    open(OUT_HTML, 'w', encoding='utf-8').write(
        tpl.replace('/*__DATA__*/null', json.dumps(out, ensure_ascii=False)))
    print(f"✓ {OUT_HTML.relative_to(ROOT)}(資料已內嵌)", file=sys.stderr)
else:
    print(f"(無模板 {TEMPLATE_PATH},略過 HTML 注入)", file=sys.stderr)
