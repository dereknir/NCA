#!/usr/bin/env python3
"""
rhythm.py — 歌曲節奏模板: 用人工審過 (done) 的 shorts 算每首歌「這句 → 下一句」通常隔幾秒

ASR 沒直接對到字的估計句 (est), 原本的時間是照轉寫文字的位置推的, 常擠在前一句後面 1–2 秒;
審核時要改的句子裡, 估計句的比例是實際對到的句子的 3 倍。改成照節奏模板推:
  中間的估計句   前後兩個實際對到的句子之間, 依模板比例分配
  結尾的估計句   最後實際對到的句子 + 模板間隔; 超過片段結尾前 END 秒 → 不標 (人工也不標)
  開頭的估計句   第一個實際對到的句子 − 模板間隔; 落在 0 秒之前 → 片段開始時已在唱, 放 0 秒
  結尾補句       模板說下一句在片段結束前就開唱 → 補一句估計句
golden 457 支留一法 (排除同一段錄音的 shorts): 完全不用改 40% → 44%, 結尾漏句 44 → 25 支, 大錯 (>3s) 76 → 70 句。

另外 event_title(): 標題是音樂祭 / 巡演回顧 → 多半不是單曲表演 (人工標 __live_song / __tour_recap / __promo),
已審 210 支裡標出 9 支, 9 支都是。

  .venv-qwen/bin/python scripts/rhythm.py --eval     # golden 留一法評估 (不寫檔)
套用在 peer_anchors.apply() 裡 (auto_annotate 跑完 / --peer 都會做), 不用另外跑。
"""
import argparse, json, re, statistics, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import auto_annotate as aa   # noqa: E402

END = 1.5                      # 結尾估計句 / 補句: 推出來的時間晚於「片段結尾 − 這個秒數」就不標
EVENT_RE = re.compile(r'RUSH BALL|ISLAND|RISING SUN|FES|フェス|WONDERLIVE|tour|ツアー|ありがとうございました', re.I)


def event_title(title):
    return bool(EVENT_RE.search(title or ''))


def samples(H, songs):
    """sid → (句, 下一句) → [(videoId, 秒數)]; 第一句在 0 秒的不算 (片段從句子中間開始, 間隔被截短)"""
    order = {sid: {idx: k for k, (idx, _j, _l) in enumerate(s['lines'])} for sid, s in songs.items()}
    out = defaultdict(lambda: defaultdict(list))
    for v, a in H.items():
        sid = a.get('songId')
        if a.get('status') != 'done' or sid not in songs:
            continue
        an = sorted(a.get('anchors') or [], key=lambda x: x['t'])
        for p, q in zip(an, an[1:]):
            if p['t'] >= 0.3 and order[sid].get(q['line']) == order[sid].get(p['line'], -9) + 1:
                out[sid][(p['line'], q['line'])].append((v, q['t'] - p['t']))
    return out


class Template:
    def __init__(self, song, gaps, exclude=()):
        self.seq = [idx for idx, _j, _l in song['lines']]
        self.order = {idx: k for k, idx in enumerate(self.seq)}
        self.gaps, self.exclude = gaps, set(exclude)

    def gap(self, i, j):
        xs = [g for u, g in self.gaps.get((i, j), []) if u not in self.exclude]
        return statistics.median(xs) if xs else None

    def span(self, i, j):
        """句 i → 句 j 的模板總秒數; 中間任一段沒資料 → None"""
        o = self.order
        if o[i] >= o[j]:
            return None
        tot = 0.0
        for k in range(o[i], o[j]):
            g = self.gap(self.seq[k], self.seq[k + 1])
            if g is None:
                return None
            tot += g
        return tot

    def next_line(self, i):
        k = self.order[i] + 1
        return self.seq[k] if k < len(self.seq) else None


def retime(anchors, tp, duration):
    """估計句照節奏模板重排時間 (實際對到的句子不動), 必要時丟掉 / 補結尾句"""
    an = sorted((dict(a) for a in anchors), key=lambda a: a['t'])
    if not any(not a.get('est') for a in an):
        return an
    out = []
    for k, a in enumerate(an):
        if not a.get('est'):
            out.append(a)
            continue
        prv = next((r for r in reversed(an[:k]) if not r.get('est')), None)
        nxt = next((r for r in an[k + 1:] if not r.get('est')), None)
        if prv and nxt:
            c1, c2 = tp.span(prv['line'], a['line']), tp.span(prv['line'], nxt['line'])
            if c1 and c2:
                a['t'] = prv['t'] + (nxt['t'] - prv['t']) * c1 / c2
        elif prv:
            c = tp.span(prv['line'], a['line'])
            if c is not None:
                a['t'] = prv['t'] + c
                if a['t'] > duration - END:
                    continue
        else:
            c = tp.span(a['line'], nxt['line'])
            if c is not None:
                a['t'] = max(nxt['t'] - c, 0.0)
        out.append(a)
    # 結尾補句: 模板說下一句在片段結束前就開唱
    last = max(out, key=lambda a: a['t'])
    while True:
        nl = tp.next_line(last['line'])
        g = tp.gap(last['line'], nl) if nl is not None else None
        if g is None or last['t'] + g > duration - END or any(x['line'] == nl for x in out):
            break
        last = {'t': last['t'] + g, 'line': nl, 'score': aa.EST_SCORE, 'est': True}
        out.append(last)
    out.sort(key=lambda a: a['t'])
    # 開頭: 0 秒附近只留句號最大的那句 (片段開始時正在唱的), 更早的句子不在片段裡
    z = [a for a in out if a['t'] <= 0.3]
    if len(z) > 1:
        keep = max(z, key=lambda a: tp.order[a['line']])
        out = [a for a in out if a['t'] > 0.3 or a is keep]
    if out and out[0].get('est') and out[0]['t'] <= 0.3:
        out[0]['t'] = 0.0
    out = aa.enforce_gap(out)
    for a in out:
        a['t'] = round(a['t'], 2)
    return out


def evaluate():
    """golden 留一法: 模板排除自己和同一段錄音的 shorts (那些交給 peer_anchors 照抄)"""
    import eval_golden as eg
    import peer_anchors as pa
    songs = aa.load_songs(); gold = eg.golden(songs)
    cache = json.loads(eg.CACHE_F.read_text(encoding='utf-8'))
    H = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    S = samples(H, songs)
    done = [v for v, a in H.items() if a.get('status') == 'done' and a.get('songId') in songs and a.get('anchors')]
    F, mean = pa.load_feats(done)
    done = [u for u in done if u in F]
    rows = defaultdict(list)
    for v, h in gold.items():
        c = cache.get(v)
        if not c or 'error' in c:
            continue
        sid = h['songId']
        base = eg.run_pipeline(c, sid, songs)['anchors']
        same = {u for u, _o, _s in pa.find_partners(v, F, done, mean)} if v in F else set()
        new = retime(base, Template(songs[sid], S[sid], {v} | same), float(c['qwen'].get('duration') or 0))
        for k in ('全部', '有估計句' if any(a.get('est') for a in base) else '沒估計句'):
            rows[k + '|新'].append(eg.score_clip(pa.canon(songs, sid, new), pa.canon(songs, sid, h['anchors'])))
            rows[k + '|舊'].append(eg.score_clip(pa.canon(songs, sid, base), pa.canon(songs, sid, h['anchors'])))
    for k in ('全部', '有估計句', '沒估計句'):
        print(f'{k:<4} 節奏 ', eg.summarize(rows[k + '|新']))
        print(f'{"":<4} 原本 ', eg.summarize(rows[k + '|舊']))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--eval', action='store_true', help='golden 留一法評估 (不寫檔)')
    args = ap.parse_args()
    if args.eval:
        evaluate()
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
