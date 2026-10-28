"""三種方法串起來 (留一法), 全部 golden: 同錄音已審 shorts → 原曲剪出 → v3"""
import sys, json, collections, os, statistics
from pathlib import Path
import numpy as np
S = Path(__file__).resolve().parent
sys.path.insert(0, 'scripts'); sys.path.insert(0, str(S))
import auto_annotate as aa, eval_golden as eg
from audio_match import feat, best_match, FPS, REF_DIR
from eval_ref import songs, refs, ref_times, canon, sc
from eval_ref2 import local_sim

SAME, TAIL, LEAD, LOCAL_MIN = 0.95, 1.0, 1.0, 0.8
ORDER = os.environ.get('ORDER', 'peer,ref').split(',')
H = json.load(open('annotation/shorts_anchors.json'))
gold = eg.golden(songs)
gcache = json.loads(eg.CACHE_F.read_text(encoding='utf-8'))
F = lambda v, _c={}: _c.setdefault(v, feat(aa.DEFAULT_AUDIO / f'{v}.m4a'))
RT = {rv: ref_times(rv) for vs in refs.values() for rv in vs}
RT = {rv: t for rv, t in RT.items() if t and len(t) >= 5}            # 轉寫幾乎沒字的參考 (remix 63 秒那支) 不用
RF = {rv: feat(aa.DEFAULT_AUDIO / 'ref' / f'{rv}.m4a') for rv in RT}

# 同錄音的已審 shorts
P = json.load(open(REF_DIR / 'peer_pairs.json'))
partners = collections.defaultdict(list)
for k, (off, sim, ov) in P.items():
    a, b = k.split('|')
    if sim >= SAME:
        partners[a].append((b, off)); partners[b].append((a, -off))

# 已審 shorts ↔ 原曲 (算人工時間池)
M = {}
for v, a in H.items():
    if a.get('status') == 'done' and a.get('songId') in refs and (aa.DEFAULT_AUDIO / f'{v}.m4a').exists():
        c = [(best_match(F(v), RF[rv]), rv) for rv in refs[a['songId']] if rv in RF]
        if c:
            (off, sim, *_), rv = max(c, key=lambda x: x[0][1])
            M[v] = (rv, off, sim)
pool = collections.defaultdict(lambda: collections.defaultdict(list))
for v, (rv, off, sim) in M.items():
    if sim < SAME:
        continue
    pred = {i: x for i, x, _s in RT[rv]}
    ja = {i: j.strip() for i, j, _l in songs[H[v]['songId']]['lines']}
    loc = local_sim(F(v), RF[rv], off)
    for an in H[v]['anchors']:
        if an['t'] < 0.3 or loc[min(int(an['t'] * FPS), len(loc) - 1)] < LOCAL_MIN:
            continue
        tref = an['t'] + off

        def fits(i):
            if i in pred:
                return abs(pred[i] - tref) <= 10
            lo = max((pred[j] for j in pred if j < i), default=-1); hi = min((pred[j] for j in pred if j > i), default=1e9)
            return lo < tref < hi
        ok = [i for i, j in ja.items() if j == ja.get(an['line']) and fits(i)]
        if ok:
            pool[rv][min(ok, key=lambda i: abs(pred.get(i, tref) - tref))].append((v, tref))


def by_peer(v, sid, dur):
    got = collections.defaultdict(list); spans = []; lead = None
    for u, off in partners.get(v, []):
        if H[u].get('songId') != sid:
            continue
        du = F(u).shape[1] / FPS
        loc = local_sim(F(v), F(u), off)
        lo, hi = max(0, -off), min(dur, du - off)
        spans.append((lo, hi))
        for a in H[u]['anchors']:
            t = a['t'] - off
            if a['t'] < 0.3:
                if abs(off) > 0.5:
                    continue
                t = 0.0
            if not (lo <= t <= hi - 0.5) or t > dur - TAIL or loc[min(int(t * FPS), len(loc) - 1)] < LOCAL_MIN:
                continue
            got[a['line']].append(t)
        before = [a for a in H[u]['anchors'] if a['t'] - off < 0]
        if off > 0.3 and before and lead is None:
            lead = max(before, key=lambda a: a['t'])['line']
    if not spans:
        return None, []
    out = [{'t': round(statistics.median(ts), 2), 'line': l} for l, ts in got.items()]
    if lead is not None and not any(a['t'] < LEAD for a in out):
        out.append({'t': 0.0, 'line': lead})
    return out, spans


def by_ref(v, sid, dur):
    c = [(best_match(F(v), RF[rv]), rv) for rv in refs.get(sid, []) if rv in RF]
    if not c:
        return None, []
    (off, sim, *_), rv = max(c, key=lambda x: x[0][1])
    if sim < SAME:
        return None, []
    tb = []
    for idx, x, s in RT[rv]:
        hs = [t for u, t in pool[rv].get(idx, []) if u != v]
        tb.append((idx, statistics.median(hs) if hs else x))
    have = {i for i, _ in tb}
    for idx, lst in pool[rv].items():
        hs = [t for u, t in lst if u != v]
        if idx not in have and hs:
            tb.append((idx, statistics.median(hs)))
    tb.sort(key=lambda r: r[1])
    loc = local_sim(F(v), RF[rv], off)
    ok = lambda t: loc[min(max(int(t * FPS), 0), len(loc) - 1)] >= LOCAL_MIN
    out, prev = [], None
    for idx, x in tb:
        t = x - off
        if t < 0:
            prev = idx; continue
        if t > dur - TAIL:
            break
        if not ok(t):
            continue
        if not out and prev is not None and t >= LEAD and ok(0):
            out.append({'t': 0.0, 'line': prev})
        out.append({'t': round(t, 2), 'line': idx})
    if not out and prev is not None and ok(0):
        out.append({'t': 0.0, 'line': prev})
    return out, [(max(0, -off), min(dur, RF[rv].shape[1] / FPS - off))]


rows = collections.defaultdict(list); used = collections.Counter()
for v, h in gold.items():
    c = gcache.get(v)
    if not c or 'error' in c:
        continue
    sid = h['songId']; dur = F(v).shape[1] / FPS
    v3 = eg.run_pipeline(c, sid, songs)['anchors']
    final, src = None, 'v3'
    for m in ORDER:
        mine, spans = (by_peer if m == 'peer' else by_ref)(v, sid, dur)
        if mine is not None:
            cov = lambda t: any(lo <= t <= hi for lo, hi in spans)
            merged = sorted(mine + [a for a in v3 if not cov(a['t'])], key=lambda a: a['t'])
            seen, final = set(), []
            for a in merged:
                if a['line'] not in seen:
                    seen.add(a['line']); final.append(a)
            src = m
            break
    final = final if final is not None else v3
    used[src] += 1
    r = sc(sid, final, h['anchors']); r0 = sc(sid, v3, h['anchors'])
    for k in ('全部', src, 'scratch' if not h.get('autoGrade') else 'assisted'):
        rows[k + '|新'].append(r); rows[k + '|v3'].append(r0)
print('順序', ORDER, '· 用到的方法', dict(used))
for k in ['全部', 'peer', 'ref', 'v3', 'scratch', 'assisted']:
    if rows.get(k + '|新'):
        print(f'  {k:<8} 新 ', eg.summarize(rows[k + '|新']))
        print(f'  {"":<8} v3 ', eg.summarize(rows[k + '|v3']))
