"""整首參考音訊 → 每一句的開始時間 (全域單調對齊), 對照官方字幕驗證"""
import sys, json, re
import numpy as np
from rapidfuzz import fuzz
sys.path.insert(0, 'scripts')
import auto_annotate as aa

T = 55          # 低於這個分數不算對到


def score_matrix(lines, hira):
    """sc[i, s] = 第 i 句從轉寫第 s 個字開始的相似度"""
    n, m = len(lines), len(hira)
    sc = np.zeros((n, m + 1), dtype=np.float32)
    for i, lh in enumerate(lines):
        if len(lh) < 2:
            continue
        L = len(lh)
        for s in range(m):
            w = hira[s:s + L + 2]
            if len(w) < max(2, L // 2):
                break
            al = fuzz.partial_ratio_alignment(lh, w)
            # 只算「從 s 開始」的對齊 (dest_start 要在開頭附近), 否則同一段字會在好幾個 s 都拿高分
            if al and al.dest_start <= 1:
                sc[i, s] = al.score
    return sc


def full_align(lines, hira):
    """回傳每句的轉寫位置 (對不到 = None)。DP: 句子依序、位置遞增, 每句可跳過。"""
    n, m = len(lines), len(hira)
    sc = score_matrix(lines, hira)
    gain = np.where(sc >= T, sc - T + 1, 0)
    NEG = -1e9
    B = np.zeros(m + 1)                    # B[s]: 已處理的句子、最後用到的字 < s 的最佳總分
    back = []
    for i, lh in enumerate(lines):
        V = np.where(gain[i] > 0, B + gain[i], NEG)       # 第 i 句放在 s
        adv = max(1, int(len(lh) * 0.6))                  # 這句至少吃掉 adv 個字, 下一句才能開始
        Vs = np.full(m + 1, NEG)
        if adv <= m:
            Vs[adv:] = V[:m + 1 - adv]
        cm = np.maximum.accumulate(Vs)
        arg = np.zeros(m + 1, dtype=int); best = -1
        for s in range(m + 1):                            # argmax 也要跟著 accumulate
            if Vs[s] > (Vs[best] if best >= 0 else NEG) and Vs[s] > NEG / 2:
                best = s
            arg[s] = best - adv if best >= 0 else -1
        take = cm > B
        back.append((take.copy(), arg.copy()))
        B = np.where(take, cm, B)
    pos = [None] * n; s = m
    for i in range(n - 1, -1, -1):
        take, arg = back[i]
        if take[s]:
            pos[i] = int(arg[s]); s = pos[i]
    return pos, sc


def times_from(pos, lines, ct, dur):
    """位置 → 秒; 對不到的句子依字數比例在前後對到的句子之間內插"""
    n = len(lines)
    t = [float(ct[min(p, len(ct) - 1)]) if p is not None else None for p in pos]
    known = [i for i in range(n) if t[i] is not None]
    if not known:
        return t, [True] * n
    est = [x is None for x in t]
    for i in range(n):
        if t[i] is None:
            lo = max((j for j in known if j < i), default=None); hi = min((j for j in known if j > i), default=None)
            if lo is not None and hi is not None:
                w = [len(lines[k]) for k in range(lo, hi)]
                t[i] = t[lo] + (t[hi] - t[lo]) * sum(w[:i - lo]) / max(sum(w), 1)
    return t, est


def align_song(song, tr):
    """兩份轉寫 (Qwen / whisper) 各自整首對齊; 對到句數多的當主, 另一份只在主的沒對到、且落在前後句之間時補"""
    lines = [lh for _i, _ja, lh in song['lines']]
    runs = []
    for t_ in [tr, tr.get('alt')]:
        if not t_:
            continue
        p, _ = full_align(lines, t_['hira'])
        ct = t_['char_time']
        runs.append([float(ct[min(x, len(ct) - 1)]) if x is not None else None for x in p])
    runs.sort(key=lambda r: -sum(x is not None for x in r))
    t = list(runs[0]); src = ['m' if x is not None else None for x in t]
    for other in runs[1:]:
        for i, x in enumerate(other):
            if t[i] is None and x is not None:
                lo = max((t[j] for j in range(i) if t[j] is not None), default=-1)
                hi = min((t[j] for j in range(i + 1, len(t)) if t[j] is not None), default=1e9)
                if lo + aa.MIN_GAP <= x <= hi - aa.MIN_GAP:
                    t[i], src[i] = x, 'o'
    known = [i for i in range(len(t)) if t[i] is not None]
    for i in range(len(t)):
        if t[i] is None:
            lo = max((j for j in known if j < i), default=None); hi = min((j for j in known if j > i), default=None)
            if lo is not None and hi is not None:
                w = [len(lines[k]) for k in range(lo, hi)]
                t[i] = t[lo] + (t[hi] - t[lo]) * sum(w[:i - lo]) / max(sum(w), 1)
            src[i] = 'est'
    return t, src


def parse_srt(p):
    out = []
    for b in open(p, encoding='utf-8').read().strip().split('\n\n'):
        x = b.split('\n')
        if len(x) < 3:
            continue
        h, m_, s = x[1].split(' --> ')[0].replace(',', '.').split(':')
        out.append((int(h) * 3600 + int(m_) * 60 + float(s), ' '.join(x[2:])))
    return out


if __name__ == '__main__':
    songs = aa.load_songs()
    cache = json.loads((aa.DEFAULT_AUDIO / 'ref' / 'ref_transcripts.json').read_text())
    v = sys.argv[1]
    c = cache[v]; song = songs[c['song']]
    tr = dict(c['qwen']); tr['alt'] = c.get('alt')
    t, src = align_song(song, tr)
    sub = parse_srt(sys.argv[2]) if len(sys.argv) > 2 else []
    for k, ((idx, ja, _lh), x, s) in enumerate(zip(song['lines'], t, src)):
        st = sub[k][0] if k < len(sub) else None
        d = f'{x - st:+.2f}' if x is not None and st is not None else ''
        print(f'{idx:3d} {x if x is None else round(x, 2)!s:>7} {s:<3} 字幕 {st!s:>8} {d:>6} | {ja[:24]}')
