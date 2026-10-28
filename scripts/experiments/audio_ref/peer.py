"""shorts 互相參考: 同一首歌的 shorts 兩兩比對, 找出同一段錄音 (部分重疊也算)"""
import sys, json, collections, itertools, os
from pathlib import Path
import numpy as np
S = Path(__file__).resolve().parent
sys.path.insert(0, 'scripts'); sys.path.insert(0, str(S))
import auto_annotate as aa
from audio_match import feat, xcorr, FPS, REF_DIR

MIN_OV = float(os.environ.get('MIN_OV', 4.0))      # 至少重疊這麼多秒才算


def pair(q, r):
    """q 的第 0 格對到 r 的第 off 秒; 回傳 (off, sim, 重疊秒數)"""
    off, s = xcorr(q, r, min_overlap=int(MIN_OV * FPS))
    i = int(np.argmax(s))
    ov = min(q.shape[1], r.shape[1] - off[i] * FPS) - max(0, -off[i] * FPS)
    return float(off[i]), float(s[i]), float(ov / FPS)


if __name__ == '__main__':
    H = json.load(open('annotation/shorts_anchors.json'))
    by = collections.defaultdict(list)
    for v, a in H.items():
        if a.get('status') == 'done' and a.get('songId') and a.get('anchors') and (aa.DEFAULT_AUDIO / f'{v}.m4a').exists():
            by[a['songId']].append(v)
    F = {v: feat(aa.DEFAULT_AUDIO / f'{v}.m4a') for vs in by.values() for v in vs}
    res = {}
    sims = []
    for sid, vs in by.items():
        for a, b in itertools.combinations(vs, 2):
            off, sim, ov = pair(F[a], F[b])
            sims.append(sim)
            res[f'{a}|{b}'] = (off, sim, ov)
    json.dump(res, open(REF_DIR / 'peer_pairs.json', 'w'))
    sims = np.array(sims)
    print(f'同一首歌的 done shorts 兩兩比對 {len(sims)} 對')
    for th in (0.85, 0.9, 0.93, 0.95, 0.97):
        print(f'  相似度 ≥{th}: {np.sum(sims >= th)} 對')
    print('  直方圖', np.histogram(sims, bins=[0, .7, .8, .85, .88, .9, .92, .94, .96, .98, 1.01])[0].tolist())
    for th in (0.93, 0.95):
        has = collections.Counter()
        for k, (off, sim, ov) in res.items():
            if sim >= th:
                a, b = k.split('|'); has[a] += 1; has[b] += 1
        vt = collections.Counter((H[v].get('versionType') or '-') for v in has)
        tot = collections.Counter((H[v].get('versionType') or '-') for vs in by.values() for v in vs)
        print(f'  ≥{th} 有夥伴的 done shorts: {len(has)} / {sum(tot.values())} · 依類型', {k: f'{vt[k]}/{tot[k]}' for k in tot})
