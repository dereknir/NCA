#!/usr/bin/env python3
"""
eval_golden.py — 用「全部人工 done」當 golden set, 離線評估 align() (含 hybrid 換時間)

逐字稿 (含逐字時間) 只需轉寫一次存起來, 之後每改一次演算法重算只要幾秒:
  1) 轉寫 (一次, ~10s/支, 可續跑):  .venv-qwen/bin/python scripts/eval_golden.py --dump
  2) 評估:                          .venv-qwen/bin/python scripts/eval_golden.py [--split dev|test|all] [-v]

golden = status=done、真歌、≥3 anchors。videoId 雜湊分成 dev (2/3, 調參數用) / test (1/3, 最後驗收用)。
test 被看過幾次之後就不乾淨了: --split fresh 只評「快照之後才標成 done」的片段 (快照 = eval_seen.txt 裡的 videoId),
當全新的驗收集用; 用完要換一份時 --snapshot 重寫快照。新片段要先 --dump 轉寫。
「從零手標」跟「看著模型答案改」(有 autoGrade) 分開統計 — 後者會偏向模型原本的答案。
歌名一律用人工的 (認歌另外評, 這裡只評句子 + 時間)。

指標 (逐支):
  句子 P/R   標了哪幾句 vs 人工
  ≤1s        共同句裡時間差 ≤1 秒的比例
  >3s        共同句裡時間差 >3 秒的句數 (大錯)
  完美       句子集合完全一樣且每句 ≤1s (≈ 審核時不用改)
  選錯段     共同句不到人工的一半 (多半是副歌選到另一次; 這種 >3s 反而算 0, 所以要另外看)
"""
import argparse, hashlib, json, statistics, sys, time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import auto_annotate as aa   # noqa: E402

CACHE_F = aa.DEFAULT_AUDIO / 'golden_transcripts.json'
KEYS = ('hira', 'char_time', 'duration', 'segments')


def golden(songs):
    H = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    return {v: a for v, a in sorted(H.items())
            if a.get('status') == 'done' and a.get('songId') in songs and len(a.get('anchors') or []) >= 3}


SEEN_F = Path(__file__).resolve().parent / 'eval_seen.txt'


def seen_ids():
    if not SEEN_F.exists():
        return set()
    return {l.strip() for l in SEEN_F.read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#')}


def in_split(vid, split, seen):
    """有快照時 dev / test / all 只評快照裡的片段, 新標的只進 fresh (不然調 dev 等於在 fresh 上調)"""
    if split == 'fresh':
        return vid not in seen
    if seen and vid not in seen:
        return False
    return split == 'all' or split_of(vid) == split


def snapshot(label, force=False):
    H = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    ids = sorted(v for v, a in H.items() if a.get('status') == 'done')
    old = seen_ids()
    if old and not force:
        sys.exit(f'已有快照 ({len(old)} 支, 現在 done {len(ids)} 支); 重拍會把 fresh 的 {len(set(ids) - old)} 支吸進去, 確定要就加 --force')
    SEEN_F.write_text(f'# {label}: 這之前標成 done 的片段 ({len(ids)} 支); --split fresh 只評不在這裡的\n'
                      + '\n'.join(ids) + '\n', encoding='utf-8')
    print(f'快照 {len(ids)} 支 → {SEEN_F.name}')


def split_of(vid):
    return 'test' if int(hashlib.md5(vid.encode()).hexdigest(), 16) % 3 == 0 else 'dev'


def dump(songs, cache_f):
    aa.ENGINE = 'hybrid'
    gold = golden(songs)
    out = json.loads(cache_f.read_text(encoding='utf-8')) if cache_f.exists() else {}
    todo = [v for v in gold if v not in out]
    print(f'golden {len(gold)} · 已轉寫 {len(gold) - len(todo)} · 待跑 {len(todo)}', flush=True)
    t0 = time.time()
    for k, v in enumerate(todo, 1):
        try:
            tr = aa.transcribe(aa.download(v, aa.DEFAULT_AUDIO), 'small', None)
            out[v] = {'qwen': {x: tr[x] for x in KEYS}, 'alt': {x: tr['alt'][x] for x in KEYS} if tr.get('alt') else None}
        except Exception as e:
            out[v] = {'error': f'{type(e).__name__}: {e}'[:300]}
        cache_f.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
        el = time.time() - t0
        print(f'[{k}/{len(todo)}] {v} {"ERR" if "error" in out[v] else "ok"} · 剩約 {el / k * (len(todo) - k) / 60:.0f} 分', flush=True)


def run_pipeline(c, sid, songs):
    """跟 process() 一樣: Qwen 轉寫跑 analyze, C 級再用 whisper 轉寫跑一次取較好的 (歌名固定用人工的)"""
    tr = dict(c['qwen']); tr['alt'] = c.get('alt')
    out = aa.analyze({}, tr, {}, songs, 'small', None, False, sid)
    if tr.get('alt') and out.get('grade') == 'C':
        alt = aa.analyze({}, tr['alt'], {}, songs, 'small', None, False, sid)
        if aa._rank(alt) > aa._rank(out):
            out = alt
    return out


def score_clip(anc, human):
    A = {a['line']: a['t'] for a in anc}
    Hm = {a['line']: a['t'] for a in human}
    common = A.keys() & Hm.keys()
    sd = [A[l] - Hm[l] for l in common]
    d = [abs(x) for x in sd]
    return dict(signed=sd, tp=len(common), fp=len(A.keys() - Hm.keys()), fn=len(Hm.keys() - A.keys()),
                n_t=len(d), ok1=sum(x <= 1 for x in d), big=sum(x > 3 for x in d),
                perfect=bool(A) and A.keys() == Hm.keys() and all(x <= 1 for x in d),
                lead_miss=bool(A) and min(Hm) < min(A), trail_miss=bool(A) and max(Hm) > max(A),
                wrong_sec=bool(A) and len(common) < 0.5 * len(Hm),
                empty=not A)


def summarize(rows):
    n = len(rows)
    if not n:
        return '(0 支)'
    s = Counter()
    for r in rows:
        s.update({k: int(v) for k, v in r.items() if isinstance(v, (int, bool))})
    p = s['tp'] / max(s['tp'] + s['fp'], 1); rc = s['tp'] / max(s['tp'] + s['fn'], 1)
    sd = [x for r in rows for x in r['signed']]
    bias = f' | 機器-人工 中位 {statistics.median(sd):+.2f}s' if sd else ''
    return (f'{n:4d} 支 | 完美 {s["perfect"]:3d} ({s["perfect"] / n:4.0%}) | 句 P {p:4.0%} R {rc:4.0%} | '
            f'≤1s {s["ok1"] / max(s["n_t"], 1):4.0%} | >3s {s["big"]:3d} 句 | 選錯段 {s["wrong_sec"]:3d} | 開頭漏 {s["lead_miss"]:3d} 結尾漏 {s["trail_miss"]:3d} | 空 {s["empty"]}{bias}')


def evaluate(songs, cache_f, split, verbose, only=None):
    gold = golden(songs)
    H = json.loads(aa.ANCHORS_F.read_text(encoding='utf-8'))
    cache = json.loads(cache_f.read_text(encoding='utf-8'))
    seen = seen_ids()
    if split == 'fresh':
        if not seen:
            sys.exit(f'缺 {SEEN_F.name}, 先 --snapshot <日期>')
        new = [v for v in gold if v not in seen]
        print(f'[fresh] 快照之後新標的 golden {len(new)} 支 · 已轉寫 {sum(v in cache and "error" not in cache[v] for v in new)} 支')
    rows = {'scratch': [], 'assisted': []}
    detail = []
    for v, h in gold.items():
        c = cache.get(v)
        if not c or 'error' in c or not in_split(v, split, seen) or (only and v not in only):
            continue
        # 同歌先驗只拿同一個 split、而且不含這支自己的人工答案 (留一法)
        songs[h['songId']]['prior'] = aa.line_prior(H, h['songId'], lambda u: u != v and in_split(u, split, seen))
        out = run_pipeline(c, h['songId'], songs)
        anc = out['anchors']
        r = score_clip(anc, h['anchors'])
        rows['assisted' if h.get('autoGrade') else 'scratch'].append(r)
        rows.setdefault('grade_' + out['grade'], []).append(r)
        detail.append((v, h, anc, r))
    print(f'[{split}] 從零手標  ' + summarize(rows['scratch']))
    print(f'[{split}] 看模型改  ' + summarize(rows['assisted']))
    print(f'[{split}] 全部      ' + summarize(rows['scratch'] + rows['assisted']))
    for g in 'ABC':
        print(f'[{split}]   {g} 級     ' + summarize(rows.get('grade_' + g, [])))
    if verbose:
        for v, h, anc, r in detail:
            if r['perfect']:
                continue
            A = {a['line']: a['t'] for a in anc}; Hm = {a['line']: a['t'] for a in h['anchors']}
            dt = {l: round(A[l] - Hm[l], 1) for l in sorted(A.keys() & Hm.keys()) if abs(A[l] - Hm[l]) > 1}
            print(f'  {v} {h["songId"][8:]:<18} 機器 {sorted(A)} 人工 {sorted(Hm)} Δt>1s {dt}')
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dump', action='store_true', help='轉寫所有 golden (可續跑)')
    ap.add_argument('--cache', type=Path, default=CACHE_F)
    ap.add_argument('--split', choices=['dev', 'test', 'all', 'fresh'], default='dev')
    ap.add_argument('--snapshot', metavar='LABEL', help='把目前所有 done 的片段寫成快照 (之後 --split fresh 只評快照之後新標的)')
    ap.add_argument('--force', action='store_true', help='--snapshot 覆蓋既有快照')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()
    songs = aa.load_songs()
    if args.snapshot:
        snapshot(args.snapshot, args.force)
    elif args.dump:
        dump(songs, args.cache)
    else:
        evaluate(songs, args.cache, args.split, args.verbose, set(args.only or []))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
