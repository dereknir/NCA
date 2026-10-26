#!/usr/bin/env python3
"""
auto_annotate.py — 本地 ASR (faster-whisper, CPU) 幫 shorts 自動打「歌詞句 ↔ 時間」anchor

每支 short:
  1. yt-dlp 下載音訊 (bestaudio m4a; 快取在 --audio-dir, 預設 %LOCALAPPDATA%/nca-audio-cache; 下載間隔 1.2s)
  2. faster-whisper 轉寫 (ja, word timestamps); queue 已猜到歌時, 用該歌歌詞片段當 initial_prompt 偏置詞彙
  3. 歌曲辨識: 轉寫文字(假名化) 對每首歌全文(假名化) 做 partial_ratio, 看最高分與第二名差距
  4. 對齊: 歌詞句逐句在轉寫文字上找最佳子串 (rapidfuzz partial_ratio_alignment), 單調遞增鏈,
     每個起始句各試一條鏈, 取總分最高; anchor 時間 = 子串第一個假名所屬 word 的 start
  5. 版本類型: 標題關鍵字 (THE FIRST TAKE→tft, 弾き語り→acoustic, MV→mv, live/ライブ/ツアー→live)
輸出 annotation/auto_anchors.json (含逐字稿、候選歌、信心、評級 A/B/C — annotator 審核面板讀這個)。
--merge 把 A/B 級結果以 status='auto' 寫進 shorts_anchors.json; 人工在 annotator 按 Enter 才變 done,
網站 import_anchors.py 只吃 done, 所以未審核的不會上線。

用法:
  python scripts/auto_annotate.py --validate --limit 40   # 拿已人工標好的 shorts 驗證準確率 (不寫檔)
  python scripts/auto_annotate.py --todo [--limit N]     # 跑所有未完成的; 可中斷, 重跑會續接
  python scripts/auto_annotate.py --ids VID1 VID2        # 指定幾支 (強制重跑)
  python scripts/auto_annotate.py --merge                # 寫入 shorts_anchors.json (status=auto)
"""
import argparse, json, os, random, re, shutil, sys, time, unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from rapidfuzz import fuzz
import pykakasi

ROOT = Path(__file__).resolve().parent.parent
QUEUE_F = ROOT / 'annotation' / 'annotation_queue.json'
ANCHORS_F = ROOT / 'annotation' / 'shorts_anchors.json'
LYRICS_F = ROOT / 'data' / 'lyrics.json'
OUT_F = ROOT / 'annotation' / 'auto_anchors.json'
DEFAULT_AUDIO = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'nca-audio-cache'
TRUSTED_METHODS = {'hashtag', 'lyric_match'}
MIN_LINE = 4          # 假名長度不足的歌詞句不參與對齊 (太短會亂配)
LINE_CUTOFF = 55      # 單句對齊最低分
EST_SCORE = 50        # 回填/前導/結尾估計句的名目分數
DL_SLEEP = 1.2        # 下載間隔 (秒) — 對 YouTube 禮貌

# ---------- 文字正規化: 全部轉假名, 去標點空白 ----------
_kks = pykakasi.kakasi()
_PUNCT = re.compile(r'[\s\u3000、。,.!?！？…・「」『』()（）\-~〜♪"\'“”‘’:;：；/／]')

def to_hira(s: str) -> str:
    s = unicodedata.normalize('NFKC', s or '')
    s = ''.join(x['hira'] for x in _kks.convert(s))
    return _PUNCT.sub('', s).lower()

def load_songs():
    data = json.loads(LYRICS_F.read_text(encoding='utf-8'))
    songs = {}
    for s in data['songs']:
        if s.get('instrumental') or not s.get('lyric_lines'):
            continue
        lines = [(l['index'], l['ja'], to_hira(l['ja'])) for l in s['lyric_lines']]
        songs[s['id']] = dict(id=s['id'], title=s['title'], lines=lines,
                              full=''.join(h for _, _, h in lines))
    return songs

# ---------- 音訊下載 (快取) ----------
def download(vid: str, audio_dir: Path) -> Path:
    audio_dir.mkdir(parents=True, exist_ok=True)
    hits = [p for p in audio_dir.glob(vid + '.*') if p.suffix != '.part']
    if hits:
        return hits[0]
    from yt_dlp import YoutubeDL
    opts = {'format': 'bestaudio[ext=m4a]/bestaudio/best', 'outtmpl': str(audio_dir / (vid + '.%(ext)s')),
            'quiet': True, 'no_warnings': True, 'noprogress': True, 'retries': 2}
    with YoutubeDL(opts) as y:
        y.download([f'https://www.youtube.com/shorts/{vid}'])
    time.sleep(DL_SLEEP)
    hits = [p for p in audio_dir.glob(vid + '.*') if p.suffix != '.part']
    if not hits:
        raise RuntimeError('no audio file produced')
    return hits[0]

# ---------- ASR ----------
_models = {}
def get_model(name: str):
    if name not in _models:
        from faster_whisper import WhisperModel
        t0 = time.time()
        _models[name] = WhisperModel(name, device='cpu', compute_type='int8')
        print(f'[auto] model {name} loaded in {time.time()-t0:.0f}s', flush=True)
    return _models[name]

def transcribe(path: Path, model_name: str, prompt=None):
    segs, info = get_model(model_name).transcribe(
        str(path), language='ja', word_timestamps=True, beam_size=5,
        condition_on_previous_text=False, initial_prompt=prompt, vad_filter=False)
    segments, hira, char_time = [], [], []
    for s in segs:
        segments.append({'t': round(s.start, 2), 'text': s.text.strip()})
        for w in (s.words or []):
            h = to_hira(w.word)
            hira.append(h)
            char_time.extend([w.start] * len(h))
    return dict(duration=info.duration, segments=segments, hira=''.join(hira), char_time=char_time)

def lyric_prompt(song, line_hint):
    lines = song['lines']
    k = line_hint if isinstance(line_hint, int) and 0 <= line_hint < len(lines) else 0
    return ' '.join(ja for _, ja, _ in lines[max(0, k - 1): k + 7])[:150]

# ---------- 歌曲辨識 ----------
def identify(tr_hira: str, songs):
    if len(tr_hira) < 8:
        return []
    scored = sorted(((fuzz.partial_ratio(tr_hira, s['full']), sid) for sid, s in songs.items()), reverse=True)
    return scored[:3]

# ---------- 對齊: 歌詞句 → 轉寫文字子串 → 時間 ----------
def _chain_from(lines, hira, j0):
    """從第 j0 句開始貪婪往下對, 回傳 (total, chain[(idx, pos, score)]); 含補漏/前導/結尾估計句"""
    n = len(lines)
    pos, chain, misses, total = 0, [], 0, 0.0
    pending_miss = None
    for j in range(j0, n):
        if len(hira) - pos < 3:
            break
        idx, _ja, lh = lines[j]
        if len(lh) < MIN_LINE:
            continue
        al = fuzz.partial_ratio_alignment(lh, hira[pos:], score_cutoff=LINE_CUTOFF)
        if al is None:
            misses += 1
            if misses >= 2:
                break
            pending_miss = (idx, pos)
            continue
        misses = 0
        start = pos + al.dest_start
        if pending_miss and start - pending_miss[1] >= 3:      # 中間被 ASR 吃掉的一句: 用兩句之間的文字起點估時間
            chain.append((pending_miss[0], pending_miss[1], EST_SCORE))
        pending_miss = None
        chain.append((idx, start, al.score))
        total += al.score
        pos = max(pos + al.dest_end, start + 1)
    if not chain:
        return None
    first_idx, first_start, _ = chain[0]
    if first_start >= 6 and first_idx > 0:                     # 前導半句: 影片一開始唱的是前一句
        chain.insert(0, (first_idx - 1, 0, EST_SCORE))
    last_idx = chain[-1][0]
    if len(hira) - pos >= 6 and last_idx + 1 < n and not any(c[0] == last_idx + 1 for c in chain):
        chain.append((last_idx + 1, pos, EST_SCORE))            # 結尾半句: 下一句已經開唱
    return total, chain

def align(song, tr):
    hira, ct = tr['hira'], tr['char_time']
    lines = song['lines']
    # 每個起始句一條鏈; 以「真正對到的句子集合」去重 (起點提早一句會得到完全相同的鏈)
    by_key = {}
    for j0 in range(len(lines)):
        r = _chain_from(lines, hira, j0)
        if not r:
            continue
        key = frozenset(c[0] for c in r[1] if c[2] != EST_SCORE)
        if key and (key not in by_key or r[0] > by_key[key][0]):
            by_key[key] = r
    if not by_key:
        return [], False
    ranked = sorted(by_key.values(), key=lambda r: -r[0])
    best = ranked[0]
    # 副歌重複: 不同句集合但總分幾乎相同 → 有歧義; 若 queue 給了標題句 (lineHint) 就用它挑
    rivals = [r for r in ranked[1:] if r[0] >= best[0] * 0.97]
    ambiguous = bool(rivals)
    if rivals:
        # 副歌重複: 驗證集裡人工 4/4 都選「後面那次」(shorts 多剪自最後一段副歌) → 取句號最大的鏈
        best = max([best] + rivals, key=lambda r: max(c[0] for c in r[1]))
    anchors = []
    for idx, start, score in best[1]:
        t = ct[min(start, len(ct) - 1)] if ct else 0.0
        a = {'t': round(float(t), 2), 'line': idx, 'score': round(float(score), 1)}
        if score == EST_SCORE:
            a['est'] = True                                     # 估計的 (沒直接對到字), 審核時多留意
        anchors.append(a)
    anchors.sort(key=lambda a: (a['t'], a['line']))
    return anchors, ambiguous

def guess_version(title: str):
    t = (title or '').lower()
    if 'first take' in t or re.search(r'\btft\b', t):
        return 'tft'
    if '弾き語り' in t or 'acoustic' in t:
        return 'acoustic'
    if 'music video' in t or re.search(r'(^|[\s#])mv\b', t):
        return 'mv'
    if 'live' in t or 'ライブ' in t or 'tour' in t or 'ツアー' in t or 'ワンマン' in t:
        return 'live'
    return None

# ---------- 單支處理 ----------
def process(vid, item, songs, model_name, audio_dir, two_pass=True, force_song=None):
    rec = {'videoId': vid, 'title': item.get('title'), 'queueSongId': item.get('songId'),
           'matchMethod': item.get('matchMethod'), 'model': model_name}
    try:
        path = download(vid, audio_dir)
    except Exception as e:
        rec['error'] = f'download: {type(e).__name__}: {str(e)[:120]}'
        return rec
    guess = item.get('songId') if item.get('songId') in songs else None
    try:
        tr = transcribe(path, model_name, None)          # 第一遍不給 prompt: 段落猜錯的 prompt 會把 ASR 帶歪
    except Exception as e:
        rec['error'] = f'asr: {type(e).__name__}: {str(e)[:120]}'
        return rec
    top = identify(tr['hira'], songs)
    rec['songCandidates'] = [{'songId': s, 'score': round(float(sc), 1)} for sc, s in top]
    score_of = {s: sc for sc, s in top}
    s1 = top[0][0] if top else 0
    s2 = top[1][0] if len(top) > 1 else 0
    sid, conflict = None, False
    if force_song:
        sid = force_song
    elif guess and (not top or top[0][1] == guess or score_of.get(guess, 0) >= s1 - 12 or s1 < 68):
        sid = guess                                  # queue 猜測成立 (ASR 同意或無強烈反對)
    elif top and ((s1 >= 50 and s1 - s2 >= 4) or s1 - s2 >= 8):   # 第二名是雜訊底 (~30), 看差距比看絕對分可靠
        sid, conflict = top[0][1], bool(guess)       # ASR 自己認出來
    rec.update(songId=sid, duration=round(float(tr['duration']), 1), transcript=tr['segments'],
               versionType=guess_version(item.get('title')), conflict=conflict)
    if not sid:
        rec.update(anchors=[], confidence=0, needsReview=['no_song'], grade='C')
        return rec
    anchors, ambiguous = align(songs[sid], tr)
    if two_pass:
        # 第二遍: 用第一遍對到的段落 (或 lineHint / 開頭) 的歌詞當 prompt 重轉, 兩次對齊取總分高的
        real1 = [a for a in anchors if not a.get('est')]
        hint = min(a['line'] for a in real1) if real1 else item.get('lineHint')
        try:
            tr2 = transcribe(path, model_name, lyric_prompt(songs[sid], hint if isinstance(hint, int) else 0))
            anchors2, ambiguous2 = align(songs[sid], tr2)
            score = lambda arr: sum(a['score'] for a in arr if not a.get('est'))
            if score(anchors2) > score(anchors):
                anchors, ambiguous, tr = anchors2, ambiguous2, tr2
                rec['transcript'] = tr2['segments']
        except Exception:
            pass
    real = [a for a in anchors if not a.get('est')]
    mean = sum(a['score'] for a in real) / len(real) if real else 0
    reasons = []
    if len(real) < 2: reasons.append('anchors<2')
    if mean < 65: reasons.append('low_align')
    if s1 < 50 and len(real) < 3: reasons.append('low_song_score')
    if conflict: reasons.append('song_conflict')
    if ambiguous: reasons.append('ambiguous_start')
    grade = ('A' if not reasons else
             'C' if ('anchors<2' in reasons or 'low_align' in reasons or len(reasons) >= 3) else 'B')
    rec.update(anchors=anchors, confidence=round(mean, 1), needsReview=reasons, grade=grade)
    return rec

# ---------- 驗證: 拿人工標好的 shorts 跑一遍, 比 anchors ----------
def validate(args, songs, items, anchors_h, audio_dir):
    done = [(v, a) for v, a in anchors_h.items()
            if a.get('status') == 'done' and a.get('songId') in songs and len(a.get('anchors') or []) >= 3]
    random.Random(42).shuffle(done)
    done = done[:args.limit or 40]
    agg = dict(n=0, song_top1=0, song_decided=0, hum=0, hit=0, auto=0, dts=[])
    for vid, h in done:
        it = dict(items.get(vid) or {'videoId': vid, 'title': ''})
        if it.get('matchMethod') not in TRUSTED_METHODS:
            it['songId'] = None                        # 模擬 unmatched: 不給 ASR 提示
        r = process(vid, it, songs, args.model, audio_dir, two_pass=True)
        if r.get('error'):
            print(f'  {vid} ERROR {r["error"]}', flush=True); continue
        agg['n'] += 1
        top1 = (r.get('songCandidates') or [{}])[0].get('songId')
        agg['song_top1'] += top1 == h['songId']
        agg['song_decided'] += r.get('songId') == h['songId']
        if r.get('songId') != h['songId']:             # 對齊品質用人工歌 id 重算, 與辨識錯誤隔離
            r2 = process(vid, it, songs, args.model, audio_dir, two_pass=True, force_song=h['songId'])
            auto = r2.get('anchors', [])
        else:
            auto = r.get('anchors', [])
        H = {a['line']: a['t'] for a in h['anchors']}
        A = {a['line']: a['t'] for a in auto}
        hit = [l for l in A if l in H]
        dts = [abs(A[l] - H[l]) for l in hit]
        agg['hum'] += len(H); agg['auto'] += len(A); agg['hit'] += len(hit); agg['dts'] += dts
        med = round(sorted(dts)[len(dts)//2], 2) if dts else None
        c = r.get('songCandidates') or []
        sc = f"{c[0]['score']:.0f}/{c[1]['score']:.0f}" if len(c) > 1 else '-'
        print(f"  {vid} {h['songId'][8:24]:<16} top1={'OK' if top1==h['songId'] else 'NG'}({sc}) hum={len(H)} auto={len(A)} "
              f"hit={len(hit)} medΔt={med} grade={r.get('grade')} {','.join(r.get('needsReview') or [])}", flush=True)
    n = max(agg['n'], 1)
    dts = sorted(agg['dts'])
    print('\n[validate] 樣本', agg['n'], '| model', args.model)
    print(f"  歌曲辨識 ASR top1 正確: {agg['song_top1']}/{n} ({agg['song_top1']/n:.0%})   最終判定正確: {agg['song_decided']}/{n}")
    print(f"  anchors 召回: {agg['hit']}/{agg['hum']} ({agg['hit']/max(agg['hum'],1):.0%})   精確: {agg['hit']}/{agg['auto']} ({agg['hit']/max(agg['auto'],1):.0%})")
    if dts:
        print(f"  時間誤差 中位 {dts[len(dts)//2]:.2f}s · ≤0.5s {sum(d<=.5 for d in dts)/len(dts):.0%} · ≤1.0s {sum(d<=1 for d in dts)/len(dts):.0%} · ≤2.0s {sum(d<=2 for d in dts)/len(dts):.0%}")

# ---------- 合併: A/B 級寫進 shorts_anchors.json (status=auto) ----------
def merge(out_path):
    auto = json.loads(out_path.read_text(encoding='utf-8'))['items']
    anchors = json.loads(ANCHORS_F.read_text(encoding='utf-8'))
    n = skipped = 0
    for vid, r in auto.items():
        cur = anchors.get(vid)
        if cur and cur.get('status') in ('done', 'skip'):
            continue
        if cur and cur.get('status') == 'pending' and cur.get('anchors'):
            skipped += 1; continue                       # 人工已開始打, 不覆蓋
        if not r.get('songId') or not r.get('anchors') or r.get('grade') == 'C':
            continue
        anchors[vid] = {'songId': r['songId'], 'anchors': [{'t': a['t'], 'line': a['line']} for a in r['anchors']],
                        'status': 'auto', 'versionType': r.get('versionType'), 'instrumental': False,
                        'source': 'auto', 'autoGrade': r['grade']}
        n += 1
    ANCHORS_F.write_text(json.dumps(anchors, ensure_ascii=False, indent=2), encoding='utf-8')
    pub = ROOT / 'public' / 'annotate' / 'auto_anchors.json'         # annotator 的 🤖 面板讀這份 (候選歌/逐字稿)
    shutil.copyfile(out_path, pub)
    print(f'[merge] 寫入 {n} 支 status=auto (跳過 {skipped} 支人工進行中) → {ANCHORS_F.name}; 建議檔同步到 {pub.relative_to(ROOT)}')

# ---------- CLI ----------
def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--todo', action='store_true'); ap.add_argument('--ids', nargs='*')
    ap.add_argument('--validate', action='store_true'); ap.add_argument('--merge', action='store_true')
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--model', default='small')
    ap.add_argument('--audio-dir', default=str(DEFAULT_AUDIO)); ap.add_argument('--out', default=str(OUT_F))
    ap.add_argument('--no-two-pass', action='store_true')
    ap.add_argument('--retry-model', default='medium', help='C 級再用這個模型重跑一次 (空字串=不重跑)')
    args = ap.parse_args()
    out_path, audio_dir = Path(args.out), Path(args.audio_dir)
    if args.merge:
        return merge(out_path)
    songs = load_songs()
    queue = json.loads(QUEUE_F.read_text(encoding='utf-8'))['queue']
    items = {it['videoId']: dict(it, group=k) for k, g in queue.items() for it in g}
    anchors_h = json.loads(ANCHORS_F.read_text(encoding='utf-8'))
    if args.validate:
        return validate(args, songs, items, anchors_h, audio_dir)
    out = json.loads(out_path.read_text(encoding='utf-8')) if out_path.exists() else {'meta': {}, 'items': {}}
    if args.ids:
        ids = list(args.ids)
    else:
        ids = [v for v in items if anchors_h.get(v, {}).get('status') not in ('done', 'skip') and v not in out['items']]
        ids.sort(key=lambda v: (items[v]['group'] == '__unmatched', -(items[v].get('viewCount') or 0)))
    if args.limit:
        ids = ids[:args.limit]
    print(f'[auto] 待處理 {len(ids)} 支 · model={args.model} · 音訊快取 {audio_dir}', flush=True)
    def save():
        out['meta'] = {'model': args.model, 'updated': time.strftime('%Y-%m-%d %H:%M'), 'count': len(out['items'])}
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    t0 = time.time()
    with ThreadPoolExecutor(1) as ex:                    # 背景序列預下載, 主執行緒同時轉寫
        futs = {v: ex.submit(download, v, audio_dir) for v in ids}
        try:
            for i, v in enumerate(ids, 1):
                try:
                    futs[v].result()
                except Exception as e:
                    out['items'][v] = {'videoId': v, 'error': f'download: {type(e).__name__}: {str(e)[:120]}'}
                else:
                    rec = process(v, items.get(v, {'videoId': v}), songs, args.model, audio_dir,
                                  two_pass=not args.no_two_pass)
                    if args.retry_model and rec.get('grade') == 'C' and not rec.get('error'):
                        # C 級 (聽不清/對不上) 用較大的模型再試一次, 取較好的
                        rec2 = process(v, items.get(v, {'videoId': v}), songs, args.retry_model, audio_dir,
                                       two_pass=not args.no_two_pass)
                        sc = lambda r: (bool(r.get('songId')), sum(a['score'] for a in (r.get('anchors') or []) if not a.get('est')))
                        if not rec2.get('error') and sc(rec2) > sc(rec):
                            rec = rec2
                    out['items'][v] = rec
                r = out['items'][v]
                print(f"[{i}/{len(ids)}] {v} {r.get('grade','-')} song={r.get('songId')} anchors={len(r.get('anchors') or [])} "
                      f"conf={r.get('confidence')} {r.get('error','')} ({(time.time()-t0)/i:.1f}s/支)", flush=True)
                if i % 5 == 0:
                    save()
        finally:
            save()
    print(f'[auto] 完成 {len(ids)} 支, 共 {(time.time()-t0)/60:.1f} 分鐘')

if __name__ == '__main__':
    main()
