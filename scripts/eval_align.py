#!/usr/bin/env python3
"""
eval_align.py — 離線評估 auto_annotate.py 的「句子對齊」(不跑 ASR, 不用音訊)

golden set = 人工審核過 (status=done, 真歌, ≥2 anchors) 且 auto_anchors.json 裡有逐字稿的 shorts。
用逐字稿重建假名串 → 跑 auto_annotate.align() → 跟人工 anchors 比「標了哪幾句」。
逐字稿只有段落級時間, 所以這裡只評句子集合, 不評秒數 (秒數在 --validate 用真 ASR 評)。

用法 (repo root):
  python scripts/eval_align.py            # 摘要
  python scripts/eval_align.py -v         # 逐支列出 差異
調整 align() 之後重跑, 比較「句子集合完全一致」「開頭漏句」「結尾多句」三個數字。
"""
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import auto_annotate as aa   # noqa: E402  (只用 to_hira / load_songs / align, 不會載 whisper)


def rebuild_transcript(rec):
    """段落級逐字稿 → align() 要的 {hira, char_time}; 每段的字在 [t, 下一段 t) 內線性鋪開"""
    segs = rec.get('transcript') or []
    dur = float(rec.get('duration') or 0) or (segs[-1]['t'] + 10 if segs else 0)
    hira, ct = [], []
    for i, s in enumerate(segs):
        h = aa.to_hira(s['text'])
        if not h:
            continue
        t0 = float(s['t']); t1 = float(segs[i + 1]['t']) if i + 1 < len(segs) else dur
        step = max(t1 - t0, 0.5) / max(len(h), 1)
        hira.append(h); ct.extend(t0 + k * step for k in range(len(h)))
    return {'hira': ''.join(hira), 'char_time': ct, 'duration': dur}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-v', '--verbose', action='store_true')
    ap.add_argument('--only', nargs='*', help='只看這些 videoId')
    args = ap.parse_args()
    songs = aa.load_songs()
    anchors = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    auto = json.loads(aa.OUT_F.read_text(encoding='utf-8'))['items']
    gold = [(v, a) for v, a in anchors.items()
            if a.get('status') == 'done' and a.get('songId') in songs and len(a.get('anchors') or []) >= 2
            and v in auto and auto[v].get('transcript') and not auto[v].get('error')]
    if args.only:
        gold = [g for g in gold if g[0] in set(args.only)]
    n = len(gold)
    exact = lead_miss = trail_extra = mid_miss = song_ok = 0
    tp = fp = fn = 0
    rows = []
    for v, h in gold:
        rec = auto[v]
        song = songs[h['songId']]
        anc, ambiguous = aa.align(song, rebuild_transcript(rec))
        A = sorted({a['line'] for a in anc}); H = sorted({a['line'] for a in h['anchors']})
        SA, SH = set(A), set(H)
        tp += len(SA & SH); fp += len(SA - SH); fn += len(SH - SA)
        ok = SA == SH; exact += ok
        if A and H:
            lead_miss += min(A) > min(H)
            trail_extra += max(A) > max(H)
            mid_miss += any(l not in SA for l in H if min(A) < l < max(A))
        song_ok += rec.get('songId') == h['songId']
        rows.append((v, h['songId'], H, A, ok, ambiguous, rec.get('grade')))
    print(f'golden set {n} 支 (人工 done + 有逐字稿)')
    print(f'  句子集合完全一致: {exact}/{n} ({exact/max(n,1):.0%})')
    print(f'  句子精確 {tp}/{tp+fp} ({tp/max(tp+fp,1):.0%}) · 召回 {tp}/{tp+fn} ({tp/max(tp+fn,1):.0%})')
    print(f'  開頭漏句 {lead_miss} · 結尾多句 {trail_extra} · 中間漏句 {mid_miss} · ASR 認歌正確 {song_ok}/{n}')
    if args.verbose:
        print()
        for v, sid, H, A, ok, amb, g in rows:
            if ok and not args.only:
                continue
            miss = sorted(set(H) - set(A)); extra = sorted(set(A) - set(H))
            print(f'  {"OK " if ok else "NG "} {v} {sid[8:22]:<14} {g} 人工{H[0]}-{H[-1]}({len(H)}) 機器{A[0] if A else "-"}-{A[-1] if A else "-"}({len(A)})'
                  f'{"  漏:"+str(miss) if miss else ""}{"  多:"+str(extra) if extra else ""}{"  ambiguous" if amb else ""}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
