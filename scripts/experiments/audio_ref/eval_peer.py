"""shorts 互相參考 (留一法): 同錄音的已審 shorts → 照抄重疊部分的人工 anchors; 沒涵蓋的部分用 v3"""
import sys, json, collections, os, statistics
from pathlib import Path
import numpy as np
S = Path(__file__).resolve().parent
sys.path.insert(0, 'scripts'); sys.path.insert(0, str(S))
import auto_annotate as aa, eval_golden as eg
from audio_match import feat, FPS, REF_DIR
from eval_ref import canon, sc, songs
from eval_ref2 import local_sim

SAME = 0.95
TAIL = float(os.environ.get('TAIL', 2.0))
LOCAL_MIN = 0.8
EDGE = 1.0          # 重疊區邊界這麼近的人工 anchor 不照抄 (夥伴片段的開頭半句 / 結尾)


def main():
    H = json.load(open('annotation/shorts_anchors.json'))
    P = json.load(open(REF_DIR / 'peer_pairs.json'))
    partners = collections.defaultdict(list)          # v → [(u, off: v 的 0 秒對到 u 的第幾秒, sim)]
    for k, (off, sim, ov) in P.items():
        a, b = k.split('|')
        if sim >= SAME:
            partners[a].append((b, off)); partners[b].append((a, -off))
    gold = eg.golden(songs)
    gcache = json.loads(eg.CACHE_F.read_text(encoding='utf-8'))
    rows = collections.defaultdict(list); ex = []; cover = []
    for v, h in gold.items():
        c = gcache.get(v)
        if not partners.get(v) or not c or 'error' in c:
            continue
        sid = h['songId']
        q = feat(aa.DEFAULT_AUDIO / f'{v}.m4a'); dur = q.shape[1] / FPS
        v3 = eg.run_pipeline(c, sid, songs)['anchors']
        got = collections.defaultdict(list); spans = []
        for u, off in partners[v]:
            if H[u].get('songId') != sid:
                continue
            r = feat(aa.DEFAULT_AUDIO / f'{u}.m4a'); du = r.shape[1] / FPS
            loc = local_sim(q, r, off)
            lo, hi = max(0, -off), min(dur, du - off)          # 重疊區 (v 的時間)
            spans.append((lo, hi))
            for a in H[u]['anchors']:
                t = a['t'] - off
                if a['t'] < 0.3:                                 # 夥伴的開頭半句 (標在 0 秒)
                    if abs(off) <= 0.5:
                        t = 0.0                                  # 兩支從同一點開始剪: 一樣是開頭半句
                    else:
                        continue                                 # 不是真的句首, 不能照抄
                if not (lo <= t <= hi - 0.5) or t > dur - TAIL:
                    continue
                if loc[min(int(t * FPS), len(loc) - 1)] < LOCAL_MIN:
                    continue
                got[a['line']].append(t)
        covered = lambda t: any(lo <= t <= hi for lo, hi in spans)
        mine = [{'t': round(statistics.median(ts), 2), 'line': l} for l, ts in got.items()]
        # 重疊區開頭若在片段 0 秒, 而夥伴在那之前還有句子 → 片段開頭的半句 = 夥伴裡最後一句早於 0 秒的
        if not any(m['t'] < 1.0 for m in mine):
            for u, off in partners[v]:
                before = [a for a in H[u]['anchors'] if a['t'] - off < 0]
                if off > 0.3 and H[u].get('songId') == sid and before:
                    mine.append({'t': 0.0, 'line': max(before, key=lambda a: a['t'])['line']})
                    break
        cov = sum(hi - lo for lo, hi in spans) / dur if spans else 0
        cover.append(min(cov, 1))
        merged = mine + [a for a in v3 if not covered(a['t'])]
        merged.sort(key=lambda a: a['t'])
        # 同一句同時出現 (夥伴 + v3) → 留夥伴的
        seen, out = set(), []
        for a in merged:
            if a['line'] in seen:
                continue
            seen.add(a['line']); out.append(a)
        rows['互相參考'].append(sc(sid, out, h['anchors']))
        rows['v3'].append(sc(sid, v3, h['anchors']))
        r = rows['互相參考'][-1]
        if not r['perfect']:
            A = {a['line']: a['t'] for a in canon(sid, out)}; Hm = {a['line']: a['t'] for a in canon(sid, h['anchors'])}
            ex.append((v, sid[8:], f'cov {cov:.0%}', sorted(A.keys() - Hm.keys()), sorted(Hm.keys() - A.keys()),
                       {l: round(A[l] - Hm[l], 1) for l in A.keys() & Hm.keys() if abs(A[l] - Hm[l]) > 1}))
    print(f'有同錄音夥伴的 golden: {len(cover)} 支 · 夥伴涵蓋片段長度 中位 {np.median(cover):.0%}')
    for k, rs in rows.items():
        print(f'  {k:<6}', eg.summarize(rs))
    if os.environ.get('V'):
        for x in ex:
            print('   ', x)


if __name__ == '__main__':
    main()
