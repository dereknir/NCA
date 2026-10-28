"""原曲時間表 + (已審同錄音 shorts 的人工時間, 留一法) + (官方字幕校正) → 套到從原曲剪出的 shorts"""
import sys, json, collections, os, statistics
from pathlib import Path
import numpy as np
S = Path(__file__).resolve().parent
sys.path.insert(0, 'scripts'); sys.path.insert(0, str(S))
import auto_annotate as aa, eval_golden as eg
from eval_ref import songs, refs, ref_times, canon, sc, SAME, LEAD_MIN
from full_align import parse_srt
from audio_match import feat, best_match, FPS, REF_DIR

LOCAL_MIN = float(os.environ.get('LOCAL_MIN', 0.8))   # 局部 (3 秒) 相似度低於這個 = 片段這裡被剪接 / 淡出, 不套用
SNAP = float(os.environ.get('SNAP', 1.0))             # 字幕校正: 最近的字幕開始點在這麼多秒內才吸過去
TAIL = float(os.environ.get('TAIL', 0.75))           # 片段結束前這幾秒才開始的句子不標
LEAD = float(os.environ.get('LEAD', 1.0))
USE_H = os.environ.get('USE_H', '1') == '1'
USE_S = os.environ.get('USE_S', '1') == '1'


def local_sim(q, r, off):
    k = int(round(off * FPS))
    n = q.shape[1]
    s = np.full(n, -1.0)
    i0, i1 = max(0, -k), min(n, r.shape[1] - k)
    if i1 > i0:
        s[i0:i1] = (q[:, i0:i1] * r[:, i0 + k:i1 + k]).sum(0)
    w = int(3 * FPS)
    valid = (s > -1).astype(float)
    num = np.convolve(np.where(s > -1, s, 0), np.ones(w), mode='same')
    den = np.convolve(valid, np.ones(w), mode='same')
    return np.where(den > w / 4, num / np.maximum(den, 1), -1)


def main():
    H = json.load(open('annotation/shorts_anchors.json'))
    RT = {rv: ref_times(rv) for vs in refs.values() for rv in vs}
    RF = {rv: feat(aa.DEFAULT_AUDIO / 'ref' / f'{rv}.m4a') for rv in RT if RT[rv]}
    subs = {}
    for rv in RT:
        f = next((REF_DIR / f'{rv}.{l}.srt' for l in ('zh-Hans', 'zh-Hant', 'en') if (REF_DIR / f'{rv}.{l}.srt').exists()), None)
        if f:
            subs[rv] = np.array([x for x, _ in parse_srt(f)])
    # 1) 所有 done shorts 跟原曲比對
    M = {}
    for v, a in H.items():
        if a.get('status') != 'done' or a.get('songId') not in refs or not (aa.DEFAULT_AUDIO / f'{v}.m4a').exists():
            continue
        q = feat(aa.DEFAULT_AUDIO / f'{v}.m4a')
        c = [(best_match(q, RF[rv]), rv) for rv in refs[a['songId']] if rv in RF]
        if c:
            (off, sim, _o2, _s2), rv = max(c, key=lambda x: x[0][1])
            M[v] = (rv, off, sim, q)
    # 2) 人工時間池: 同錄音的 done shorts, 人工 anchor → 原曲時間
    pool = collections.defaultdict(lambda: collections.defaultdict(list))
    for v, (rv, off, sim, q) in M.items():
        if sim < SAME:
            continue
        sid = H[v]['songId']
        pred = {idx: x for idx, x, _s in RT[rv]}
        ja = {idx: j.strip() for idx, j, _l in songs[sid]['lines']}
        loc = local_sim(q, RF[rv], off)
        for an in H[v]['anchors']:
            if an['t'] < 0.3 or loc[min(int(an['t'] * FPS), len(loc) - 1)] < LOCAL_MIN:
                continue
            tref = an['t'] + off
            same = [i for i, j in ja.items() if j == ja.get(an['line'])]
            def fits(i):
                # 跟預測時間差 10 秒內; 沒有預測時間的句子 (整首對齊漏掉的頭尾) 要落在前後有預測的句子之間
                if i in pred:
                    return abs(pred[i] - tref) <= 10
                lo = max((pred[j] for j in pred if j < i), default=-1); hi = min((pred[j] for j in pred if j > i), default=1e9)
                return lo < tref < hi
            ok = [i for i in same if fits(i)]
            if ok:
                i = min(ok, key=lambda i: abs(pred.get(i, tref) - tref))
                pool[rv][i].append((v, tref))

    def table(rv, exclude):
        out = []
        for idx, x, s in RT[rv]:
            hs = [t for v, t in pool[rv].get(idx, []) if v != exclude] if USE_H else []
            if hs:
                out.append((idx, statistics.median(hs), 'h'))
                continue
            if USE_S and rv in subs:
                d = subs[rv] - x
                j = int(np.argmin(np.abs(d)))
                if abs(d[j]) <= SNAP:
                    out.append((idx, float(subs[rv][j]), 's'))
                    continue
            out.append((idx, x, s))
        have = {r[0] for r in out}
        for idx, lst in pool[rv].items():
            hs = [t for v, t in lst if v != exclude] if USE_H else []
            if idx not in have and hs:
                out.append((idx, statistics.median(hs), 'h'))
        out.sort(key=lambda r: r[1])
        return out

    def transfer(tb, off, loc, dur):
        out, prev = [], None
        ok = lambda t: loc[min(max(int(t * FPS), 0), len(loc) - 1)] >= LOCAL_MIN
        for idx, x, s in tb:
            t = x - off
            if t < 0:
                prev = idx
                continue
            if t > dur - TAIL:
                break
            if not ok(t):
                continue
            if not out and prev is not None and t >= LEAD and ok(0):
                out.append({'t': 0.0, 'line': prev, 'est': True})
            out.append({'t': round(t, 2), 'line': idx})
        if not out and prev is not None and ok(0):
            out.append({'t': 0.0, 'line': prev, 'est': True})
        return out

    gold = eg.golden(songs)
    gcache = json.loads(eg.CACHE_F.read_text(encoding='utf-8'))
    rows = collections.defaultdict(list); ex = []; srcs = collections.Counter()
    split = sys.argv[1] if len(sys.argv) > 1 else None
    for v, h in gold.items():
        if v not in M or M[v][2] < SAME or (split and eg.split_of(v) != split):
            continue
        rv, off, sim, q = M[v]
        tb = table(rv, v)
        srcs.update(s for _i, _x, s in tb)
        mine = transfer(tb, off, local_sim(q, RF[rv], off), q.shape[1] / FPS)
        r = sc(h['songId'], mine, h['anchors'])
        rows['原曲'].append(r)
        c = gcache.get(v)
        if c and 'error' not in c:
            rows['v3'].append(sc(h['songId'], eg.run_pipeline(c, h['songId'], songs)['anchors'], h['anchors']))
        if not r['perfect']:
            A = {a['line']: a['t'] for a in canon(h['songId'], mine)}; Hm = {a['line']: a['t'] for a in canon(h['songId'], h['anchors'])}
            ex.append((v, h['songId'][8:], round(sim, 3), sorted(A.keys() - Hm.keys()), sorted(Hm.keys() - A.keys()),
                       {l: round(A[l] - Hm[l], 1) for l in A.keys() & Hm.keys() if abs(A[l] - Hm[l]) > 1}))
    print(f'時間表來源 (句次): {dict(srcs)}')
    for k, rs in rows.items():
        print(f'  {k:<4}', eg.summarize(rs))
    if os.environ.get('V'):
        for x in ex:
            print('   ', x)


if __name__ == '__main__':
    main()
