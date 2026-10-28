"""還沒審的 shorts (auto / pending) → 在所有已審 shorts + 原曲裡找同一段錄音"""
import sys, json, collections, os
from pathlib import Path
import numpy as np
S = Path(__file__).resolve().parent
sys.path.insert(0, 'scripts'); sys.path.insert(0, str(S))
import auto_annotate as aa
from audio_match import feat, xcorr, FPS, REF_DIR, REFS_F

SAME = 0.95
H = json.load(open('annotation/shorts_anchors.json'))
refs = json.load(open(REFS_F))
done = [v for v, a in H.items() if a.get('status') == 'done' and a.get('songId') and a.get('anchors') and (aa.DEFAULT_AUDIO / f'{v}.m4a').exists()]
todo = [v for v, a in H.items() if a.get('status') in ('auto', 'pending') and (aa.DEFAULT_AUDIO / f'{v}.m4a').exists()]
F = {v: feat(aa.DEFAULT_AUDIO / f'{v}.m4a') for v in done + todo}
R = {rv: feat(aa.DEFAULT_AUDIO / 'ref' / f'{rv}.m4a') for vs in refs.values() for rv in vs}
ref_song = {rv: sid for sid, vs in refs.items() for rv in vs}
# 用平均 chroma 先篩候選 (同一首歌的 key / 和聲接近), 省掉大部分 FFT
mean = lambda c: c.mean(1) / (np.linalg.norm(c.mean(1)) + 1e-9)
M = {v: mean(F[v]) for v in F}
out = {}
for k, v in enumerate(todo):
    q = F[v]
    best = []
    for u in done:
        if float(M[v] @ M[u]) < 0.85:
            continue
        off, s = xcorr(q, F[u], min_overlap=int(4 * FPS))
        i = int(np.argmax(s))
        if s[i] >= SAME:
            best.append(('peer', u, float(off[i]), float(s[i]), H[u]['songId']))
    for rv, r in R.items():
        off, s = xcorr(q, r)
        i = int(np.argmax(s))
        if s[i] >= SAME:
            best.append(('ref', rv, float(off[i]), float(s[i]), ref_song[rv]))
    out[v] = best
    if k % 100 == 0:
        print(k, len(todo), flush=True)
json.dump(out, open(REF_DIR / 'unlabeled_matches.json', 'w'))
st = collections.Counter(H[v]['status'] for v in todo)
peer = [v for v in todo if any(b[0] == 'peer' for b in out[v])]
ref = [v for v in todo if any(b[0] == 'ref' for b in out[v])]
either = [v for v in todo if out[v]]
print(f'還沒審 {len(todo)} 支 {dict(st)}')
print(f'  找到同錄音的已審 shorts: {len(peer)} 支 · 是原曲剪出來的: {len(ref)} 支 · 至少一種: {len(either)} 支 ({len(either) / len(todo):.0%})')
g = collections.Counter(H[v].get('autoGrade') for v in either)
print('  這些目前的評級:', dict(g))
dis = [v for v in either if len({b[4] for b in out[v]}) > 1]
wrong = [v for v in either if H[v].get('songId') and H[v]['songId'] not in {b[4] for b in out[v]}]
print(f'  比對到的歌互相矛盾: {len(dis)} 支 · 目前機器認的歌跟比對結果不同: {len(wrong)} 支', wrong[:10])
