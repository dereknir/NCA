#!/usr/bin/env python3
"""
peer_anchors.py — 同一段錄音的 shorts 互相參考

官方常把同一段演出剪成好幾支 shorts。未審的片段只要跟某支已審 (done) 的片段是同一段錄音 (部分重疊也算),
重疊部分直接照抄人工 anchors (換算時間位移), 沒涵蓋到的部分保留 ASR (auto_annotate) 的結果。
同錄音的不同片段, 人工 anchors 彼此差 ≤0.3 秒; golden 354 支 (留一法) 完全不用改 38% → 55%, 見
annotation/reports/2026-10-28-audio-reference.md。

判斷同一段錄音: chroma (12 個音高的能量) 互相關。同錄音 ≥0.98, 不同演出 ≤0.94 (5192 對裡中間只有 1 對)。

  .venv-qwen/bin/python scripts/peer_anchors.py          # 套用到 auto_anchors.json (auto_annotate 跑完會自動做)
  .venv-qwen/bin/python scripts/peer_anchors.py --eval   # golden 留一法: 照抄 vs ASR

ASR 原本的結果存在每筆的 `asr` 欄位; 重算一律從它出發 (你審得越多, 夥伴越多, 隔一陣子重跑就會更準)。
"""
import argparse, json, statistics, sys, time
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import auto_annotate as aa   # noqa: E402

SR, HOP = 16000, 512
FPS = SR / HOP                 # chroma 每秒 31.25 格
FEAT_DIR = aa.DEFAULT_AUDIO / 'feat'
SAME = 0.95                    # 整體相似度 ≥ 這個 = 同一段錄音
MIN_OV = 4.0                   # 至少重疊這麼多秒
LOCAL_MIN = 0.8                # 局部 (3 秒) 相似度低於這個 = 那裡被剪接 / 淡出, 不照抄
TAIL = 1.0                     # 片段結束前這幾秒才開始的句子不標 (人工最後一句離結尾最少 1.02 秒)
LEAD = 1.0                     # 開頭半句: 第一句照抄的句子離 0 秒至少這麼遠才補
PREFILTER = 0.8                # 平均 chroma 相似度低於這個的配對不做互相關 (省時間)
KEEP = ('songId', 'anchors', 'grade', 'confidence', 'needsReview')


def feat(path: Path):
    """chroma (12 x N), 每格 L2 正規化; 快取成 npy"""
    FEAT_DIR.mkdir(exist_ok=True)
    f = FEAT_DIR / (path.stem + '.npy')
    if f.exists():
        return np.load(f)
    import librosa
    y, _ = aa.load_16k(path)
    c = librosa.feature.chroma_stft(y=y, sr=SR, n_fft=4096, hop_length=HOP)
    n = np.linalg.norm(c, axis=0, keepdims=True)
    c = np.where(n > 1e-6, c / np.maximum(n, 1e-6), 0).astype(np.float32)
    np.save(f, c)
    return c


def match(q, r):
    """q 的第 0 秒對到 r 的第 off 秒時, 重疊部分的平均 cosine 相似度最高 → (off, sim)"""
    Nq, Nr = q.shape[1], r.shape[1]
    L = 1 << int(np.ceil(np.log2(Nq + Nr)))
    full = np.fft.irfft((np.fft.rfft(q[:, ::-1], L, axis=1) * np.fft.rfft(r, L, axis=1)).sum(0), L)[:Nq + Nr - 1]
    vq = (np.linalg.norm(q, axis=0) > 0).astype(np.float32); vr = (np.linalg.norm(r, axis=0) > 0).astype(np.float32)
    cnt = np.fft.irfft(np.fft.rfft(vq[::-1], L) * np.fft.rfft(vr, L), L)[:Nq + Nr - 1]
    sims = np.where(cnt >= MIN_OV * FPS, full / np.maximum(cnt, 1), -1)
    i = int(np.argmax(sims))
    return (i - (Nq - 1)) / FPS, float(sims[i])


def local_sim(q, r, off):
    """逐格相似度, 3 秒平均 (邊界只平均有重疊的格子)"""
    k = int(round(off * FPS)); n = q.shape[1]
    s = np.full(n, -1.0)
    i0, i1 = max(0, -k), min(n, r.shape[1] - k)
    if i1 > i0:
        s[i0:i1] = (q[:, i0:i1] * r[:, i0 + k:i1 + k]).sum(0)
    w = int(3 * FPS)
    num = np.convolve(np.where(s > -1, s, 0), np.ones(w), mode='same')
    den = np.convolve((s > -1).astype(float), np.ones(w), mode='same')
    return np.where(den > w / 4, num / np.maximum(den, 1), -1)


def find_partners(v, F, done, mean):
    """v 在已審 shorts 裡的同錄音夥伴: [(u, off, sim)]"""
    out = []
    for u in done:
        if u == v or float(mean[v] @ mean[u]) < PREFILTER:
            continue
        off, sim = match(F[v], F[u])
        if sim >= SAME:
            out.append((u, off, sim))
    return out


def transfer(v, partners, F, H):
    """夥伴的人工 anchors → v 的時間。回傳 (anchors, 涵蓋區間, 夥伴的歌)"""
    dur = F[v].shape[1] / FPS
    sid = Counter(H[u]['songId'] for u, _o, _s in partners).most_common(1)[0][0]
    got, spans, lead = defaultdict(list), [], None
    for u, off, _sim in partners:
        if H[u]['songId'] != sid:
            continue
        loc = local_sim(F[v], F[u], off)
        lo, hi = max(0.0, -off), min(dur, F[u].shape[1] / FPS - off)
        spans.append((lo, hi))
        for a in H[u]['anchors']:
            t = a['t'] - off
            if a['t'] < 0.3:                             # 夥伴的開頭半句 (標在 0 秒) 不是真的句首
                if abs(off) > 0.5:
                    continue
                t = 0.0                                  # 兩支從同一點開始剪: 一樣是開頭半句
            if not (lo <= t <= hi - 0.5) or t > dur - TAIL or loc[min(int(t * FPS), len(loc) - 1)] < LOCAL_MIN:
                continue
            got[a['line']].append(t)
        before = [a for a in H[u]['anchors'] if a['t'] - off < 0]
        if off > 0.3 and before and lead is None:        # 夥伴在 v 開始前就在唱的那句 = v 的開頭半句
            lead = max(before, key=lambda a: a['t'])['line']
    anchors = [{'t': round(statistics.median(ts), 2), 'line': l, 'peer': True} for l, ts in got.items()]
    if lead is not None and not any(a['t'] < LEAD for a in anchors):
        anchors.append({'t': 0.0, 'line': lead, 'peer': True})
    return sorted(anchors, key=lambda a: a['t']), spans, sid


def coverage(spans, dur):
    """涵蓋區間聯集 / 片段長度"""
    tot, end = 0.0, 0.0
    for lo, hi in sorted(spans):
        lo = max(lo, end)
        if hi > lo:
            tot += hi - lo; end = hi
    return round(min(1.0, tot / dur), 2) if dur else 0.0


def fix_order(anchors, song):
    """句號要隨時間嚴格遞增。不同夥伴 (或 ASR) 對一字不差的重複段可能選了不同的「第幾次」,
    混在一起會 20 → 57 → 22 → 59。在同歌詞的句號之間重選, 改動最少; 排不進去的 ASR 句子丟掉。"""
    if not song:
        return anchors
    ja = {i: j.strip() for i, j, _l in song['lines']}
    alts = [[a['line']] + sorted(i for i, j in ja.items() if j == ja.get(a['line']) and i != a['line']) for a in anchors]
    INF = float('inf')
    states = {-1: (0.0, [], None)}                               # 目前最大句號 → (成本, 選擇, 那句的時間)
    for a, al in zip(anchors, alts):
        nxt = {}
        drop, change = (5, 1.5) if a.get('peer') else (2, 1)     # 照抄的比 ASR 可靠: 改它 / 丟它的成本較高
        for last, (cost, path, lt) in states.items():
            for c, line in enumerate(al):
                if line <= last:
                    continue
                # 跳過的句數遠超過這段時間唱得完的 (一句至少 ~2.5 秒) → 多半選錯了重複段
                jump = 0 if lt is None else max(0.0, (line - last - 1) - (a['t'] - lt) / 2.5 - 1)
                v = (cost + change * (c > 0) + 0.3 * jump, path + [line], a['t'])
                if v[0] < nxt.get(line, (INF,))[0]:
                    nxt[line] = v
            v = (cost + drop, path + [None], lt)
            if v[0] < nxt.get(last, (INF,))[0]:
                nxt[last] = v
        states = nxt
    _cost, path, _t = min(states.values(), key=lambda x: x[0])
    return [dict(a, line=l) for a, l in zip(anchors, path) if l is not None]


def combine(peer, spans, asr_anchors, song=None):
    """照抄的 + 涵蓋區外的 ASR anchors (同一句只留一次, 照抄優先), 再把重複段的句號理順"""
    covered = lambda t: any(lo <= t <= hi for lo, hi in spans)
    seen, out = set(), []
    for a in sorted(peer + [a for a in asr_anchors if not covered(a['t'])], key=lambda a: a['t']):
        if a['line'] not in seen:
            seen.add(a['line']); out.append(a)
    return aa.enforce_gap(fix_order(out, song))


def load_feats(vids):
    F = {}
    for v in vids:
        p = aa.DEFAULT_AUDIO / f'{v}.m4a'
        if p.exists():
            F[v] = feat(p)
    mean = {v: c.mean(1) / (np.linalg.norm(c.mean(1)) + 1e-9) for v, c in F.items()}
    return F, mean


def apply(out_path=aa.OUT_F, ids=None):
    """auto_anchors.json 裡未審的每一支: 找同錄音的已審 shorts, 照抄; 結果寫回"""
    data = json.loads(out_path.read_text(encoding='utf-8'))
    items = data['items']
    H = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    done = [v for v, a in H.items() if a.get('status') == 'done' and a.get('songId')
            and not a['songId'].startswith('__') and a.get('anchors')]
    todo = [v for v, r in items.items() if not r.get('error') and H.get(v, {}).get('status') not in ('done', 'skip')
            and (ids is None or v in ids)]
    t0 = time.time()
    songs = aa.load_songs()
    F, mean = load_feats(done + todo)
    done = [u for u in done if u in F]
    n_peer = n_song = 0
    for v in todo:
        r = items[v]
        if 'asr' not in r:
            r['asr'] = {k: r.get(k) for k in KEEP}           # ASR 原本的結果; 之後重算都從這份出發
        base = r['asr']
        for k in KEEP:
            r[k] = base[k]
        r.pop('peer', None)
        if v not in F:
            continue
        partners = find_partners(v, F, done, mean)
        if not partners:
            continue
        peer, spans, sid = transfer(v, partners, F, H)
        if not peer:
            continue
        asr = (base['anchors'] or []) if base['songId'] == sid else []   # 夥伴是別首歌 → ASR 的 anchors 不能用
        cov = coverage(spans, F[v].shape[1] / FPS)
        r['anchors'] = combine(peer, spans, asr, songs.get(sid))
        r['songId'] = sid
        r['peer'] = {'from': [{'videoId': u, 'offset': round(o, 2), 'sim': round(s, 3)} for u, o, s in partners if H[u]['songId'] == sid],
                     'coverage': round(cov, 2), 'songChanged': base['songId'] != sid}
        if cov >= 0.9:
            r['grade'], r['needsReview'] = 'A', []
        elif r['grade'] == 'C':
            r['grade'] = 'B'
        n_peer += 1; n_song += base['songId'] != sid
    data['meta']['peer'] = {'updated': time.strftime('%Y-%m-%d %H:%M'), 'count': n_peer, 'done_refs': len(done)}
    aa.write_out(out_path, data)
    print(f'[peer] 未審 {len(todo)} 支, {n_peer} 支找到同錄音的已審 shorts (其中 {n_song} 支歌名跟 ASR 不同, 以已審的為準) · '
          f'參考 {len(done)} 支已審 · {time.time() - t0:.0f}s')
    return n_peer


def evaluate():
    """golden 留一法: 每支假裝沒審, 用其他已審 shorts 照抄; 跟 ASR (eval_golden 的 v3 結果) 比"""
    import eval_golden as eg
    songs = aa.load_songs(); gold = eg.golden(songs)
    cache = json.loads(eg.CACHE_F.read_text(encoding='utf-8'))
    H = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    done = [v for v, a in H.items() if a.get('status') == 'done' and a.get('songId') in songs and a.get('anchors')]
    F, mean = load_feats(done)
    done = [u for u in done if u in F]
    ja = {sid: {i: j.strip() for i, j, _l in s['lines']} for sid, s in songs.items()}

    def canon(sid, anchors):
        # 副歌一字不差的重複段標第幾次是隨意的 → 視為同一句; 同一片段裡第二次出現仍算不同句
        first = {}
        for i, j in ja[sid].items():
            first.setdefault(j, i)
        seen, out = Counter(), []
        for a in sorted(anchors, key=lambda a: a['t']):
            c = first[ja[sid][a['line']]]
            out.append(dict(a, line=c + 1000 * seen[c])); seen[c] += 1
        return out

    rows = defaultdict(list)
    for v, h in gold.items():
        c = cache.get(v)
        if not c or 'error' in c or v not in F:
            continue
        sid = h['songId']
        asr = eg.run_pipeline(c, sid, songs)['anchors']
        partners = find_partners(v, F, done, mean)
        final = asr
        if partners:
            peer, spans, psid = transfer(v, partners, F, H)
            if peer and psid == sid:
                final = combine(peer, spans, asr, songs[sid])
        for k in ('全部', '有夥伴' if partners else '沒夥伴'):
            rows[k + '|照抄'].append(eg.score_clip(canon(sid, final), canon(sid, h['anchors'])))
            rows[k + '|ASR'].append(eg.score_clip(canon(sid, asr), canon(sid, h['anchors'])))
    for k in ('全部', '有夥伴', '沒夥伴'):
        print(f'{k:<4} 照抄 ', eg.summarize(rows[k + '|照抄']))
        print(f'{"":<4} ASR  ', eg.summarize(rows[k + '|ASR']))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--eval', action='store_true', help='golden 留一法評估 (不寫檔)')
    ap.add_argument('--out', default=str(aa.OUT_F))
    args = ap.parse_args()
    if args.eval:
        evaluate()
    else:
        apply(Path(args.out))


if __name__ == '__main__':
    main()
