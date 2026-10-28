"""① 原曲整首時間表 vs 官方字幕  ② 從原曲剪出的 shorts: 套用原曲時間 vs 人工 (並列 v3)"""
import sys, json, collections, glob, os
from pathlib import Path
import numpy as np
S = Path(__file__).resolve().parent
sys.path.insert(0, 'scripts'); sys.path.insert(0, str(S))
import auto_annotate as aa, eval_golden as eg
from full_align import align_song, parse_srt
from audio_match import feat, best_match, REF_DIR, REFS_F

SAME = 0.95          # 相似度 ≥ 這個 = 同一段錄音
LEAD_MIN = 1.0       # 片段開頭正在唱的那句, 離下一句還有這麼多秒才標在 0 秒

songs = aa.load_songs()
refs = json.load(open(REFS_F))
cache = json.loads((aa.DEFAULT_AUDIO / 'ref' / 'ref_transcripts.json').read_text())


def ref_times(rv):
    c = cache.get(rv)
    if not c or 'error' in c:
        return None
    tr = dict(c['qwen']); tr['alt'] = c.get('alt')
    t, src = align_song(songs[c['song']], tr)
    return [(idx, x, s) for (idx, _ja, _lh), x, s in zip(songs[c['song']]['lines'], t, src) if x is not None]


def eval_subs():
    print('=== ① 原曲時間表 vs 官方字幕 (每句離最近的字幕開始點) ===')
    tot = collections.Counter()
    for sid, vs in refs.items():
        for rv in vs:
            subs = [f for f in (REF_DIR / f'{rv}.zh-Hans.srt', REF_DIR / f'{rv}.zh-Hant.srt', REF_DIR / f'{rv}.en.srt') if f.exists()]
            rt = ref_times(rv)
            if not subs or not rt:
                continue
            st = np.array([x for x, _ in parse_srt(subs[0])])
            d = [float(np.min(np.abs(st - x))) for _i, x, _s in rt]
            n_line = len(songs[sid]['lines'])
            c = collections.Counter(s for *_, s in rt)
            r = dict(n=len(d), le05=sum(x <= .5 for x in d), le1=sum(x <= 1 for x in d), gt2=sum(x > 2 for x in d), est=c['est'])
            tot.update(r)
            print(f'  {sid[8:]:<26} {len(rt):2d}/{n_line:2d} 句 · 估 {c["est"]:2d} · ≤0.5s {r["le05"] / r["n"]:4.0%} · ≤1s {r["le1"] / r["n"]:4.0%} · >2s {r["gt2"]}')
    print(f'  合計 {tot["n"]} 句 · 估 {tot["est"]} · ≤0.5s {tot["le05"] / tot["n"]:.0%} · ≤1s {tot["le1"] / tot["n"]:.0%} · >2s {tot["gt2"]}')


def canon(song_id, anchors):
    """歌詞一字不差的句子視為同一句 (副歌重複段標第幾次, 畫面上看起來一樣) → 換成第一次出現的句號"""
    first = {}
    for idx, ja, _lh in songs[song_id]['lines']:
        first.setdefault(ja.strip(), idx)
    ja_of = {idx: ja.strip() for idx, ja, _lh in songs[song_id]['lines']}
    seen = collections.Counter(); out = []
    for a in sorted(anchors, key=lambda a: a['t']):
        c = first[ja_of[a['line']]]
        out.append(dict(a, line=c + 1000 * seen[c]))          # 同一片段裡第二次出現的同一句 → 不同的鍵
        seen[c] += 1
    return out


def sc(song_id, mine, human):
    return eg.score_clip(canon(song_id, mine), canon(song_id, human))


def transfer(rt, off, dur):
    """參考時間表 → 片段 anchors"""
    out = []
    prev = None
    for k, (idx, x, s) in enumerate(rt):
        t = x - off
        if t < 0:
            prev = (k, idx, s)
            continue
        if t > dur - aa.END_GUARD:
            break
        if not out and prev and t >= LEAD_MIN:
            out.append({'t': 0.0, 'line': prev[1], 'est': True})
        out.append({'t': round(t, 2), 'line': idx, **({'est': True} if s == 'est' else {})})
    if not out and prev:
        out.append({'t': 0.0, 'line': prev[1], 'est': True})
    return out


def eval_transfer(only_split=None):
    print('\n=== ② 從原曲剪出的 shorts: 套用原曲時間 vs v3 (人工 done 當答案) ===')
    gold = eg.golden(songs)
    gcache = json.loads(eg.CACHE_F.read_text(encoding='utf-8'))
    RT = {rv: ref_times(rv) for vs in refs.values() for rv in vs}
    rows = collections.defaultdict(list); amb = 0; ex = []
    for v, h in gold.items():
        if h['songId'] not in refs or (only_split and eg.split_of(v) != only_split):
            continue
        q = feat(aa.DEFAULT_AUDIO / f'{v}.m4a')
        cands = [(best_match(q, feat(aa.DEFAULT_AUDIO / 'ref' / f'{rv}.m4a')), rv) for rv in refs[h['songId']] if RT.get(rv)]
        if not cands:
            continue
        (off, sim, off2, sim2), rv = max(cands, key=lambda x: x[0][1])
        if sim < SAME:
            continue
        if sim2 >= sim - 0.01:
            amb += 1
        dur = q.shape[1] / 31.25
        mine = transfer(RT[rv], off, dur)
        r = sc(h['songId'], mine, h['anchors'])
        rows['原曲'].append(r)
        c = gcache.get(v)
        if c and 'error' not in c:
            rows['v3'].append(sc(h['songId'], eg.run_pipeline(c, h['songId'], songs)['anchors'], h['anchors']))
        if not r['perfect']:
            A = {a['line']: a['t'] for a in canon(h['songId'], mine)}; Hm = {a['line']: a['t'] for a in canon(h['songId'], h['anchors'])}
            ex.append((v, h['songId'][8:], round(sim, 3), round(off, 1), sorted(A), sorted(Hm),
                       {l: round(A[l] - Hm[l], 1) for l in A.keys() & Hm.keys() if abs(A[l] - Hm[l]) > 1}))
    for k, rs in rows.items():
        print(f'  {k:<4}', eg.summarize(rs))
    print(f'  (副歌整段音訊一模一樣、分不出是哪一次: {amb} 支)')
    for x in ex[:25]:
        print('   ', x)


if __name__ == '__main__':
    if os.environ.get('SUBS', '1') == '1':
        eval_subs()
    eval_transfer(sys.argv[1] if len(sys.argv) > 1 else None)
