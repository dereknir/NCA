#!/usr/bin/env python3
"""
full_live_audit.py — 完整 Live 切點驗收: 每一段的開頭 / 結尾有沒有切在人聲中間、有沒有播到下一句

人聲軌用 full_live_vocals.py 分離過的快取 (沒有的會現場分離)。判斷「有在唱」用比較嚴的 LOUD_DB
(觀眾合唱 / 樂器漏進人聲軌的音量多半在 -20〜-12 dB, 不算)。
  開頭  切入點在人聲中:
          吃頭    那段人聲一路接到這句起音 → 這句的頭被切掉 (或是連唱沒換氣)
          上句尾  那段人聲在這句起音前就結束 → 混到上一句尾音 (有淡入, 影響小)
          片頭    影片一開頭就在唱 (素材本身的限制)
  結尾  切出點在人聲中 (整首最後一段淡出, 不檢查):
          下句頭  切點已經過了下一句錨點前 0.3 秒 → 播到下一句的頭, 下一段又唱一次 = 重疊
          切尾    其他 → 最後一個字被切斷
          片尾    影片最後還在唱
        overrides 的 cuts 人工確認過的切點不再標 (結尾方式顯示 manual)
  多播  影片裡沒有下一句錨點的結尾: 不給提示轉錄「錨點 → 切點」, 跟「這句 + 下一句」做序列比對,
        下一句對到一半以上 = 結尾含下一句 (給提示的話 whisper 會照提示編, 驗收不能用)

    .venv-vocals/Scripts/python -X utf8 scripts/full_live_audit.py [--songs ...] [--no-asr] [--json 報告.json]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import auto_annotate as AA          # noqa: E402
import full_live_vocals as V        # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FL = ROOT / 'src' / 'data' / 'full_live.json'
LOUD_DB = -15.0                     # 比這個大聲才算「有在唱」
EDGE = 0.04                         # 切點前後看多久


def voiced_run(db, a0, t):
    """t 秒所在的人聲段 (起, 迄) — t 不在人聲中回傳 None"""
    v = db > LOUD_DB
    f = int((t - a0) * V.FPS)
    if not (0 <= f < len(v)) or not v[f]:
        return None
    s = f
    while s > 0 and (v[s - 1] or (s > 1 and v[s - 2])):     # 1 格的小斷點不算斷
        s -= 1
    e = f
    while e + 1 < len(v) and (v[e + 1] or (e + 2 < len(v) and v[e + 2])):
        e += 1
    return a0 + s / V.FPS, a0 + (e + 1) / V.FPS


def loud_at(db, a0, t0, t1):
    f0, f1 = int((t0 - a0) * V.FPS), int((t1 - a0) * V.FPS) + 1
    seg = db[max(0, f0):max(0, min(len(db), f1))]
    return float(seg.max()) if len(seg) else -99.0


def dp_ratio(lines, chars):
    """歌詞句 ↔ 轉錄字 半全域序列比對 → {句: 對到的比例}"""
    L, LI = [], []
    for k, h in lines:
        L.extend(h)
        LI.extend([k] * len(h))
    n, m = len(L), len(chars)
    if not n or not m:
        return {}
    T = np.array([ord(c) for c in chars])
    D = np.zeros((n + 1, m + 1), dtype=np.int32)
    P = np.zeros((n + 1, m + 1), dtype=np.int8)
    D[1:, 0] = -np.arange(1, n + 1)
    P[1:, 0] = 1
    for i in range(1, n + 1):
        diag = D[i - 1, :-1] + np.where(T == ord(L[i - 1]), 2, -1)
        up = D[i - 1, 1:] - 1
        best, src = np.maximum(diag, up), np.where(diag >= up, 0, 1)
        row, prow = D[i], P[i]
        for j in range(1, m + 1):
            v, p = best[j - 1], src[j - 1]
            if row[j - 1] - 1 > v:
                v, p = row[j - 1] - 1, 2
            row[j], prow[j] = v, p
    i, j = n, int(np.argmax(D[n]))
    hit = {}
    while i > 0 and j > 0:
        p = P[i, j]
        if p == 0:
            if L[i - 1] == chars[j - 1]:
                hit[LI[i - 1]] = hit.get(LI[i - 1], 0) + 1
            i, j = i - 1, j - 1
        elif p == 1:
            i -= 1
        else:
            j -= 1
    cnt = {}
    for k in LI:
        cnt[k] = cnt.get(k, 0) + 1
    return {k: hit.get(k, 0) / cnt[k] for k in cnt}


def next_line_in(path, t0, t1, lyr, j):
    """t0–t1 (從第 j 句錨點到切點) 裡有沒有唱到第 j+1 句: 不給提示轉錄, 跟 [j, j+1] 比對"""
    if t1 - t0 < 1.0 or j + 1 >= len(lyr['lines']):
        return None
    hj, hn = lyr['lines'][j][2], lyr['lines'][j + 1][2]
    if not hn or hn == hj:
        return None
    from faster_whisper.audio import decode_audio
    a = decode_audio(str(path), sampling_rate=16000)[int(t0 * 16000):int(t1 * 16000)]
    segs, _ = AA.get_model('medium').transcribe(a, language='ja', beam_size=5, temperature=0.0, condition_on_previous_text=False)
    text = ''.join(AA.to_hira(s.text) for s in segs)
    return dp_ratio([(j, hj), (j + 1, hn)], text).get(j + 1, 0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--songs', default='')
    ap.add_argument('--no-asr', action='store_true')
    ap.add_argument('--json', default='')
    args = ap.parse_args()
    only = {x for x in args.songs.split(',') if x}
    fl = {s['id']: s for s in json.loads(FL.read_text(encoding='utf-8'))['songs']}
    lyr = AA.load_songs()
    report = []
    for ps in V.plan_songs(only):
        sid, n = ps['id'], ps['n']
        song = fl[sid]
        for gi, g in enumerate(ps['segs']):
            x = next(x for x in song['shorts'] if x['v'] == g['v'] and any(a[0] == g['from'] for a in x['am']))
            path = AA.download(g['v'], AA.DEFAULT_AUDIO)
            win = (x['am'][0][1] - V.LONG_PAD, x['end'] + V.LONG_PAD) if x.get('long') else None
            db, a0 = V.vocal_db(path, win)
            am = dict(x['am'])
            fr, to = g['from'], g['to']
            last_seg = gi == len(ps['segs']) - 1
            issues = []
            manual_in = any(l == fr for l, _ in x.get('ci', []))       # overrides 的 cuts: 人工確認過, 不再標
            manual_out = any(l == to for l, _ in x.get('co', []))
            # 開頭
            if manual_in:
                pass
            elif loud_at(db, a0, g['start'] - EDGE, g['start'] + EDGE) > LOUD_DB:
                run = voiced_run(db, a0, g['start'])
                if g['start'] < 0.05:
                    issues.append('開頭:片頭')
                elif run and run[1] >= am[fr] - 0.05:
                    issues.append('開頭:吃頭')
                else:
                    issues.append('開頭:上句尾')
            # 結尾
            if manual_out:
                pass
            elif not last_seg and loud_at(db, a0, g['end'] - EDGE, g['end']) > LOUD_DB:
                if x.get('dur') and g['end'] >= x['dur'] - 0.1:
                    issues.append('結尾:片尾')
                elif to + 1 in am and g['end'] >= am[to + 1] - 0.3:
                    issues.append('結尾:下句頭')
                else:
                    issues.append('結尾:切尾')
            # 結尾怎麼來的
            vt = x.get('vt') if x.get('vt') and x['vt'][0] == to else None
            if manual_out:
                how = 'manual'
            elif x.get('long'):
                how = 'long'
            elif to + 1 in am:
                how = 'next'
            elif vt:
                how = 'final' if to == n - 1 else ('tail?' if len(vt) > 4 and vt[4] > 0 else 'tail-next' if vt[2] is not None else 'tail')
            else:
                how = 'estimate'
                issues.append('結尾:只靠估計')
            # 多播
            if how in ('tail', 'tail-next', 'tail?', 'estimate') and not args.no_asr:
                r = next_line_in(path, am[to], g['end'], lyr[sid], to)
                if r is not None and r >= 0.5:
                    issues.append(f'多播:含第{to + 1}句({r:.2f})')
            report.append({'song': sid, 'seg': gi + 1, 'v': g['v'], 'from': fr, 'to': to, 'start': g['start'], 'end': g['end'],
                           'how': how, 'issues': issues})
            flag = ' ⚠ ' + ' / '.join(issues) if issues else ''
            print(f"{sid[8:]:22} #{gi + 1:<2} {g['v']} {fr:>2}-{to:<2} {g['start']:7.2f}→{g['end']:7.2f} [{how}]{flag}", flush=True)
    bad = [r for r in report if r['issues']]
    from collections import Counter
    c = Counter(i.split('(')[0] for r in report for i in r['issues'])
    print(f'\n共 {len(report)} 段, {len(bad)} 段有狀況: ' + ', '.join(f'{k} {v}' for k, v in c.most_common()), flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
