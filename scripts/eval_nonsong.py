#!/usr/bin/env python3
"""
eval_nonsong.py — 評估「這不是單曲」偵測 (auto_annotate.nonsong_signals) 會抓到多少非歌曲片段、誤傷多少真歌

兩部分 (都不跑 ASR):
  1) auto_anchors.json 既有結果 × 人工 done 標記: 人工歌名是 __promo / __tour_recap / __live_song… (或空) = 非歌曲。
     「抓到」= 沒配歌或評級 C (merge 不會寫進去); 「誤傷」= 真歌原本 A/B 被降成 C。
  2) golden 逐字稿 (eval_golden.py 同一份): 跑 hybrid 流程後再套偵測, 看 A 級完美率會不會掉。
dev/test 切法跟 eval_golden 一樣 (videoId 雜湊)。調參數只看 dev, test 最後看一次。

用法: python scripts/eval_nonsong.py [--split dev|test|all] [--off] [-v]
"""
import argparse, json, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import auto_annotate as aa   # noqa: E402
import eval_golden as eg     # noqa: E402


def is_nonsong(h, songs):
    return not h.get('songId') or str(h['songId']).startswith('__') or h['songId'] not in songs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--split', choices=['dev', 'test', 'all'], default='dev')
    ap.add_argument('--off', action='store_true', help='不開偵測 (baseline)')
    ap.add_argument('--cache', type=Path, default=eg.CACHE_F)
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()
    songs = aa.load_songs()
    H = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    items = json.loads(aa.OUT_F.read_text(encoding='utf-8'))['items']
    inside = lambda v: args.split == 'all' or eg.split_of(v) == args.split

    def detect(r, title):
        if args.off or not r.get('songId') or r['songId'] not in songs:
            return []
        return aa.nonsong_signals(title, [r.get('transcript')], r['songId'], songs)

    def base_grade(r):
        """偵測之前的評級: 已存結果若是新版程式跑的, 先把 not_single_song 拿掉重算 (不然誤傷會被當成本來就是 C)"""
        if not r.get('songId'):
            return 'C'
        nr = [x for x in r.get('needsReview') or [] if x != 'not_single_song']
        if 'not_single_song' not in (r.get('needsReview') or []):
            return r.get('grade')
        return 'A' if not nr else 'C' if ('anchors<2' in nr or 'low_align' in nr or len(nr) >= 3) else 'B'

    # 1) 既有結果
    c = Counter(); fps = []; why = Counter()
    for v, r in items.items():
        h = H.get(v)
        if not h or h.get('status') != 'done' or r.get('error') or not inside(v):
            continue
        ns = is_nonsong(h, songs)
        g0 = base_grade(r)
        hit = detect(r, r.get('title')) if g0 in ('A', 'B') else []
        g1 = 'C' if hit else g0
        why.update(hit if ns else [])
        if ns:
            c['ns'] += 1; c['ns_caught0'] += g0 == 'C'; c['ns_caught1'] += g1 == 'C'
            c['ns_A0'] += g0 == 'A'; c['ns_A1'] += g1 == 'A'
        else:
            c['sg'] += 1; c['sg_AB'] += g0 in ('A', 'B'); c['sg_fp'] += bool(hit); c['sg_fpA'] += bool(hit) and g0 == 'A'
            if hit:
                fps.append((v, g0, hit, (r.get('title') or '')[:50]))
        if args.verbose and ns and g0 in ('A', 'B'):
            print(f"  {'抓到' if hit else '漏掉'} {v} {h.get('songId')} {g0} {hit} {(r.get('title') or '')[:50]}")
    print(f'[{args.split}] 非歌曲 {c["ns"]} 支: 抓到 (無歌/C) {c["ns_caught0"]} → {c["ns_caught1"]} · 仍是 A 級 {c["ns_A0"]} → {c["ns_A1"]} · 訊號 {dict(why)}')
    print(f'[{args.split}] 真歌 {c["sg"]} 支 (A/B {c["sg_AB"]}): 誤傷降成 C {c["sg_fp"]} (其中原本 A 級 {c["sg_fpA"]})')
    for x in fps:
        print('   誤傷', *x)

    # 2) golden: A 級完美率
    if not args.cache.exists():
        return
    cache = json.loads(args.cache.read_text(encoding='utf-8'))
    g = Counter()
    for v, h in eg.golden(songs).items():
        cc = cache.get(v)
        if not cc or 'error' in cc or not inside(v):
            continue
        out = eg.run_pipeline(cc, h['songId'], songs)
        perf = eg.score_clip(out['anchors'], h['anchors'])['perfect']
        g0 = out['grade']
        hit = (aa.nonsong_signals((items.get(v) or {}).get('title'), [cc['qwen'].get('segments'), (cc.get('alt') or {}).get('segments')],
                                  h['songId'], songs) if g0 in ('A', 'B') and not args.off else [])
        g1 = 'C' if hit else g0
        g['n'] += 1; g['perf'] += perf
        for k, gg in (('0', g0), ('1', g1)):
            g['A' + k] += gg == 'A'; g['Aperf' + k] += gg == 'A' and perf
        g['down'] += bool(hit); g['down_perf'] += bool(hit) and perf
    if g['n']:
        print(f'[{args.split}] golden {g["n"]} 支 完美 {g["perf"]} ({g["perf"] / g["n"]:.0%}) · '
              f'A 級 {g["A0"]} 支完美 {g["Aperf0"] / max(g["A0"], 1):.1%} → {g["A1"]} 支完美 {g["Aperf1"] / max(g["A1"], 1):.1%} · '
              f'被降級 {g["down"]} (其中完美 {g["down_perf"]})')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
