#!/usr/bin/env python3
"""
auto_annotate.py — 本地 ASR (faster-whisper, CPU) 幫 shorts 自動打「歌詞句 ↔ 時間」anchor

每支 short:
  1. yt-dlp 下載音訊 (bestaudio m4a; 快取在 --audio-dir, 預設 %LOCALAPPDATA%/nca-audio-cache; 下載間隔 1.2s)
  2. faster-whisper 轉寫 (ja, word timestamps)。預設只轉一遍、不給 initial_prompt:
     用歌詞當 prompt 的第二遍 (--prompt-pass) 會讓 whisper 把 prompt 原句「抄」進輸出,
     對齊分數反而變高但句子是錯的 (驗證集裡就有被帶偏的例子), 所以只在你想實驗時才開
  3. 歌曲辨識: 轉寫文字(假名化) 對每首歌全文(假名化) 做 partial_ratio, 看最高分與第二名差距
  4. 對齊: 歌詞句逐句在轉寫文字上找最佳子串 (rapidfuzz partial_ratio_alignment), 單調遞增鏈,
     每個起始句各試一條鏈, 取總分最高; anchor 時間 = 子串第一個假名所屬 word 的 start。
     ASR 吃掉的句子 / 太短不參與比對的句子 → 夾在兩個對到的句子之間時補「估計句」(est=True),
     時間在相鄰 anchor 之間平均分; 同一時間點擠在一起的 anchor 展開, 擠在影片結尾的視為幻聽丟掉
  5. 版本類型: 標題關鍵字 (THE FIRST TAKE→tft, 弾き語り→acoustic, MV→mv, live/ライブ/ツアー→live)
輸出 annotation/auto_anchors.json (含逐字稿、候選歌、信心、評級 A/B/C — annotator 審核面板讀這個)。
--merge 把 A/B 級結果以 status='auto' 寫進 shorts_anchors.json; 人工在 annotator 按 Enter 才變 done,
網站 import_anchors.py 只吃 done, 所以未審核的不會上線。

建議用 --engine hybrid (Qwen3-ASR 定句子 + whisper 定時間; 環境見 requirements-qwen.txt, 比較數字見 annotation/HANDOFF.md)

用法:
  python scripts/auto_annotate.py --validate --limit 40   # 拿已人工標好的 shorts 驗證準確率 (不寫檔)
  python scripts/auto_annotate.py [--limit N]            # 跑所有未完成且還沒跑過的; 可中斷, 重跑會續接
  python scripts/auto_annotate.py --redo --model medium  # 全量重標: 所有非 done/skip 的都重跑 (舊結果作廢)
  python scripts/auto_annotate.py --ids VID1 VID2        # 指定幾支 (強制重跑)
  python scripts/auto_annotate.py --merge                # 寫入 shorts_anchors.json (status=auto; done/skip/人工進行中不動)
  python scripts/eval_align.py                           # 不跑 ASR, 用既有逐字稿離線評估對齊 (改演算法用)
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
PUB_F = ROOT / 'public' / 'annotate' / 'auto_anchors.json'   # annotator 🤖 面板讀這份; scripts/check_sync.py 在 CI 比對兩份一致
DEFAULT_AUDIO = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'nca-audio-cache'
TRUSTED_METHODS = {'hashtag', 'lyric_match'}
MIN_LINE = 4          # 假名長度不足的歌詞句不參與對齊 (太短會亂配)
LINE_CUTOFF = 55      # 單句對齊最低分
EST_SCORE = 50        # 回填/前導/結尾估計句的名目分數
TRAIL_MIN = 40        # 結尾估計句: 剩餘轉寫文字跟下一句的最低相似度 (低於此 = 間奏幻聽, 不補)
EXT_CUTOFF = 40       # 頭尾延伸: 鏈外的句子用較寬的門檻再對一次 (live 常唱錯字 / ASR 聽錯字, 例: 信じ止まない ↔ 信じてやまない)
EXT_EST = 1           # 頭尾延伸: 對不到字時, 最多再依「剩餘文字長度」連續估幾句 (0 = 只用文字比對)
EXT_WIN = 1.6         # 頭尾延伸: 每句只在「句長 × 這個倍數」的相鄰文字窗內找
DL_SLEEP = 1.2        # 下載間隔 (秒) — 對 YouTube 禮貌
CPU_THREADS = 4       # 單支解碼是序列的, 多核要靠多個 shard 行程平行 (見 --shard)

# ---------- 文字正規化: 全部轉假名, 去標點空白 ----------
_kks = pykakasi.kakasi()
_PUNCT = re.compile(r'[\s\u3000、。,.!?！？…・「」『』()（）\-~〜♪"\'“”‘’:;：；/／]')

_RUBY = re.compile(r'[\u4e00-\u9fff々]+[(（]([\u3041-\u3096\u30a1-\u30fcー]+)[)）]')   # 虚像(うそ) → 唱的是括號裡的讀音

def to_hira(s: str) -> str:
    s = _RUBY.sub(r'\1', unicodedata.normalize('NFKC', s or ''))
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
        _models[name] = WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=CPU_THREADS)
        print(f'[auto] model {name} loaded in {time.time()-t0:.0f}s', flush=True)
    return _models[name]

VAD = False           # --vad: whisper 先切無聲段。不建議: 實測 (medium, 40 支) 召回 71% → 6%, 有伴奏的歌聲幾乎整段被當成非人聲切掉
ENGINE = 'whisper'    # --engine qwen: 改用 Qwen3-ASR-1.7B + Qwen3-ForcedAligner (針對有伴奏的歌聲訓練; 需另裝 requirements-qwen.txt)
                      # --engine hybrid: Qwen 決定「哪幾句」, whisper (--model) 給「幾秒」— golden 40 支上最好 (見 HANDOFF)
HYBRID_WIN = 3.0      # hybrid (舊做法, HYBRID_RETIME=False): whisper 同一句的時間跟 Qwen 差在這個秒數內才採用
HYBRID_RETIME = True  # hybrid: whisper 對到的句子一律用 whisper 時間, 其餘依鄰句的 (whisper − Qwen) 位移校正
                      # golden 233 支實測: 同一句 whisper ≤1s 92% vs Qwen 82%; 兩者差 >3s 時 whisper 對 17/20
                      # whisper 沒對到的句子留 Qwen 時間 (實測: 用鄰句位移校正 73% → 67% 變差; 在 whisper 轉寫局部再找一次無明顯改善)
MIN_GAP = 0.6         # 相鄰兩句 anchor 至少間隔這麼多秒
QWEN_ASR = 'Qwen/Qwen3-ASR-1.7B'
QWEN_ALIGNER = 'Qwen/Qwen3-ForcedAligner-0.6B'

_qwen = None
def get_qwen():
    global _qwen
    if _qwen is None:
        import torch
        from qwen_asr import Qwen3ASRModel
        dev = 'mps' if torch.backends.mps.is_available() else ('cuda:0' if torch.cuda.is_available() else 'cpu')
        dt = torch.float32 if dev == 'cpu' else torch.float16
        t0 = time.time()
        _qwen = Qwen3ASRModel.from_pretrained(QWEN_ASR, dtype=dt, device_map=dev, max_inference_batch_size=1,
                                              max_new_tokens=256, forced_aligner=QWEN_ALIGNER,
                                              forced_aligner_kwargs=dict(dtype=dt, device_map=dev))
        print(f'[auto] qwen loaded on {dev} in {time.time()-t0:.0f}s', flush=True)
    return _qwen

def load_16k(path: Path):
    """任何格式 (m4a/webm…) → 16kHz mono float32; qwen-asr 自己的讀檔器 (soundfile) 吃不了 m4a"""
    import subprocess
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy(), 16000

def transcribe_qwen(path: Path):
    audio = load_16k(path)
    r = get_qwen().transcribe(audio=audio, language='Japanese', return_time_stamps=True)[0]
    items = list(r.time_stamps or [])
    hira, char_time, segments = [], [], []
    cur = None
    for it in items:
        h = to_hira(it.text)
        hira.append(h)
        char_time.extend([float(it.start_time)] * len(h))
        # 逐字稿分段 (給 annotator 面板看): 停頓 > 0.8s 就斷一段
        if cur is None or float(it.start_time) - cur['end'] > 0.8:
            cur = {'t': round(float(it.start_time), 2), 'text': '', 'end': float(it.end_time)}
            segments.append(cur)
        cur['text'] += it.text; cur['end'] = float(it.end_time)
    for sgm in segments:
        sgm.pop('end')
    return dict(duration=len(audio[0]) / audio[1], segments=segments, hira=''.join(hira), char_time=char_time)

def transcribe(path: Path, model_name: str, prompt=None):
    if ENGINE == 'qwen':
        return transcribe_qwen(path)                    # prompt 不適用 (Qwen 不吃 initial_prompt)
    if ENGINE == 'hybrid':
        # Qwen 走 GPU、whisper 走 CPU, 同時跑; align() 看到 tr['alt'] 會用 whisper 的時間重定 anchors
        from concurrent.futures import ThreadPoolExecutor as _TPE
        with _TPE(1) as ex:
            fw = ex.submit(_transcribe_whisper, path, model_name, None)
            tr = transcribe_qwen(path)
            tr['alt'] = fw.result()
        return tr
    return _transcribe_whisper(path, model_name, prompt)

def _transcribe_whisper(path: Path, model_name: str, prompt=None):
    segs, info = get_model(model_name).transcribe(
        str(path), language='ja', word_timestamps=True, beam_size=5,
        condition_on_previous_text=False, initial_prompt=prompt, vad_filter=VAD)
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
    return ' '.join(ja for _, ja, _ in lines[max(0, k - 3): k + 7])[:150]

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
    pending = []          # 還沒對到的句 (太短 / ASR 吃掉): [(idx, pos)], 等下一個對到的句子決定要不要補成估計句
    for j in range(j0, n):
        if len(hira) - pos < 3:
            break
        idx, _ja, lh = lines[j]
        if len(lh) < MIN_LINE:
            if chain:
                pending.append((idx, pos))          # 短句夾在對到的句子之間 → 補估計句 (之前是直接跳過, 永遠不會被標)
            continue
        al = fuzz.partial_ratio_alignment(lh, hira[pos:], score_cutoff=LINE_CUTOFF)
        if al is None:
            misses += 1
            if misses >= 2:
                break
            pending.append((idx, pos))
            continue
        misses = 0
        start = pos + al.dest_start
        for p_idx, p_pos in pending:
            # 鏈開始之前的漏句只在文字有空隙時補 (否則是起點選太早); 鏈內的漏句一律補,
            # 文字沒空隙 (ASR 整句吃掉) 的時間先跟下一句同點, align() 再平均展開
            if chain or start - p_pos >= 3:
                chain.append((p_idx, p_pos, EST_SCORE))
        pending = []
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
        # 結尾半句: 下一句已經開唱 — 但剩餘文字得跟下一句至少「有點像」(間奏的幻聽字串不算)
        nxt = next((lh for idx, _ja, lh in lines if idx == last_idx + 1), '')
        if nxt and fuzz.partial_ratio(nxt, hira[pos:]) >= TRAIL_MIN:
            chain.append((last_idx + 1, pos, EST_SCORE))
    return total, chain

def _extend_edges(lines, hira, chain):
    """鏈的頭尾往外延伸: 人工審核補的句子 90% 在片段頭尾 (鏈只在外面各多猜一句, 而且開頭那句的時間固定放在 0 秒)。
    逐句往外: 先在相鄰文字窗內用 EXT_CUTOFF 對字; 對不到就依剩餘文字長度估 (最多連續 EXT_EST 句); 文字用完就停。
    延伸出來的句子一律標 est (審核時多留意)。"""
    real = [c for c in chain if c[2] != EST_SCORE]
    if not real:
        return chain
    order = {idx: k for k, (idx, _ja, _lh) in enumerate(lines)}
    ends = {idx: pos + len(next(lh for i, _j, lh in lines if i == idx)) for idx, pos, _s in real}
    first, last = real[0], max(real, key=lambda c: c[1])
    head, tail = [], []
    # 往前: 文字位置 P 之前還有字就繼續
    P, k, guess = first[1], order[first[0]], 0
    while k > 0 and P >= 3:
        k -= 1
        idx, _ja, lh = lines[k]
        lo = max(0, P - int(len(lh) * EXT_WIN) - 2)
        al = fuzz.partial_ratio_alignment(lh, hira[lo:P], score_cutoff=EXT_CUTOFF) if len(lh) >= MIN_LINE else None
        if al:
            start, guess = lo + al.dest_start, 0
        elif guess < EXT_EST:
            start, guess = max(0, P - len(lh)), guess + 1
        else:
            break
        if start >= P:
            break
        head.append((idx, start, EST_SCORE))
        P = start
    # 往後: 最後一句真對到的字之後還有字就繼續
    Q, k, guess = ends[last[0]], order[last[0]], 0
    while k + 1 < len(lines) and len(hira) - Q >= 3:
        k += 1
        idx, _ja, lh = lines[k]
        hi = min(len(hira), Q + int(len(lh) * EXT_WIN) + 2)
        al = fuzz.partial_ratio_alignment(lh, hira[Q:hi], score_cutoff=EXT_CUTOFF) if len(lh) >= MIN_LINE else None
        if al:
            start, end, guess = Q + al.dest_start, Q + al.dest_end, 0
        elif guess < EXT_EST:
            start, end, guess = Q, Q + len(lh), guess + 1
        else:
            break
        tail.append((idx, start, EST_SCORE))
        Q = max(end, start + 1)
    core = [c for c in chain if order[first[0]] <= order[c[0]] <= order[last[0]]]
    return head[::-1] + core + tail


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
    chain = _extend_edges(lines, hira, best[1]) if EXT_CUTOFF else best[1]
    anchors = []
    for idx, start, score in chain:
        t = ct[min(start, len(ct) - 1)] if ct else 0.0
        a = {'t': float(t), 'line': idx, 'score': round(float(score), 1)}
        if score == EST_SCORE:
            a['est'] = True                                     # 估計的 (沒直接對到字), 審核時多留意
        anchors.append(a)
    anchors.sort(key=lambda a: (a['t'], a['line']))
    anchors = _fix_times(anchors, float(tr.get('duration') or 0))
    if tr.get('alt'):
        # hybrid: 句子用這份 (Qwen) 對齊的結果, 時間改用 whisper 對到同一句的 word timestamp (比 ForcedAligner 準)
        aw, _ = align(song, tr['alt'])
        tw = {a['line']: a['t'] for a in aw if not a.get('est')}
        if HYBRID_RETIME:
            anchors = _retime(anchors, tw)
            tw = {}
        # (舊做法) 逐句換時間, 但換完必須仍然「時間遞增、相鄰間隔 ≥ MIN_GAP」, 否則保留 Qwen 的時間
        # (以前換完再排序, 936 支裡有 22 支句號倒退、93 支兩句擠在 0.6 秒內)
        orig = [a['t'] for a in anchors]
        for k, a in enumerate(anchors):
            t = tw.get(a['line'])
            if t is None or abs(t - a['t']) > HYBRID_WIN:
                continue
            lo = anchors[k - 1]['t'] + MIN_GAP if k else float('-inf')
            hi = orig[k + 1] - MIN_GAP if k + 1 < len(anchors) else float('inf')
            if lo <= t <= hi:
                a['t'] = t
    anchors = enforce_gap(anchors)
    for a in anchors:
        a['t'] = round(a['t'], 2)
    return anchors, ambiguous


def _retime(anchors, tw):
    """hybrid 換時間: whisper 對到同一句 → 用 whisper 的, 沒對到 → 留 Qwen 的。
    換完若時間倒退 / 擠在 MIN_GAP 內, 非 whisper 的那句讓位 (改成前後兩句之間內插), 都是 whisper 的則後一句讓位。"""
    n = len(anchors)
    src = ['w' if a['line'] in tw else 'q' for a in anchors]
    if 'w' not in src:
        return anchors                                          # whisper 一句都沒對到同樣的句子: 不換
    t = [tw.get(a['line'], a['t']) for a in anchors]
    for k in range(1, n):
        if t[k] is not None and t[k - 1] is not None and t[k] < t[k - 1] + MIN_GAP:
            if src[k] == 'w' and src[k - 1] != 'w':
                t[k - 1] = None
            else:
                t[k] = None
    known = [k for k in range(n) if t[k] is not None]
    for k in range(n):
        if t[k] is None:
            lo = max((j for j in known if j < k), default=None); hi = min((j for j in known if j > k), default=None)
            if lo is not None and hi is not None:
                t[k] = t[lo] + (t[hi] - t[lo]) * (k - lo) / (hi - lo)
            else:
                t[k] = anchors[k]['t']                        # 頭尾沒有可內插的鄰居: 留 Qwen 原時間, 交給 enforce_gap
    for a, x in zip(anchors, t):
        a['t'] = max(0.0, x)
    return anchors


def enforce_gap(anchors, gap=None):
    """相鄰兩句間隔 < MIN_GAP 時只留一句: 有估計句就丟估計句, 都是實對到的就留分數高的。
    人工標註的相鄰間隔 <0.6s 只有 0.1% (2/1433), 機器結果卻有 2.7% → 擠在一起的幾乎一定有一句錯。"""
    gap = MIN_GAP if gap is None else gap
    out = []
    for a in anchors:
        if out and a['t'] - out[-1]['t'] < gap:
            p = out[-1]
            if a.get('est') and not p.get('est'):
                continue
            if (p.get('est') and not a.get('est')) or a.get('score', 0) > p.get('score', 0):
                out[-1] = a
            continue
        out.append(a)
    return out


END_GUARD = 0.75      # 影片最後這幾秒才「開始」的句子不可信 (whisper 常把幻聽的尾句標在結尾)

def _fix_times(anchors, duration):
    """同一時間點擠在一起的 anchor (漏句補的估計句 / ASR 把兩句字的時間都標在同一處):
    中間的 → 在這個時間點與下一個不同時間點之間平均展開; 擠在影片結尾的 → 幻聽, 只留第一句。
    另外丟掉在結尾 END_GUARD 秒內才開始的句子。"""
    if not anchors:
        return anchors
    out = []
    i = 0
    while i < len(anchors):
        j = i
        while j + 1 < len(anchors) and abs(anchors[j + 1]['t'] - anchors[i]['t']) < 0.05:
            j += 1
        group = anchors[i:j + 1]
        if len(group) > 1:
            t0 = group[0]['t']
            t1 = anchors[j + 1]['t'] if j + 1 < len(anchors) else duration
            if t1 - t0 >= 1.0 * len(group):
                step = (t1 - t0) / len(group)
                for k, a in enumerate(group):
                    a['t'] = t0 + k * step
                    if k:
                        a['est'] = True
            else:
                group = group[:1]                               # 擠在結尾 / 沒空間展開: 只信第一句
        out.extend(group)
        i = j + 1
    if duration:
        out = [a for a in out if a['t'] < duration - END_GUARD or a is out[0]]
    return out

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

# ---------- 認歌: 相信模型, 模型沒把握才參考佇列的高信心配對 ----------
SONG_CLEAR = (45, 10)   # 模型第一名 ≥45 分且領先第二名 ≥10 分 = 清楚認出 (第二名多是 ~30 分的雜訊底)

def decide_song(top, guess, method):
    """top = identify() 的 [(score, songId)…]。舊規則「第一名 <68 分就沿用佇列」是照 whisper 的分數訂的,
    Qwen 認對時常在 55–70 分 → 936 支裡有 140 支被佇列帶偏 (含 37 支人工確認過的歌)。
    新規則在人工確認的 159 支上 157 對 (舊 122), golden 40 支 39 對 (舊 37), 且不推翻任何 hashtag。"""
    g = guess if method in TRUSTED_METHODS else None   # 低信心的 review 配對不當提示
    if not top:
        return g
    s1, t1 = top[0]
    s2 = top[1][0] if len(top) > 1 else 0
    if s1 >= SONG_CLEAR[0] and s1 - s2 >= SONG_CLEAR[1]:
        return t1
    if g:
        return g
    if (s1 >= 50 and s1 - s2 >= 4) or s1 - s2 >= 8:
        return t1
    return None

# ---------- 單支處理 ----------
ALGO = 3              # 演算法版本; --redo 會重跑舊版本的結果 (v3: 頭尾延伸 + whisper 時間優先, 每支 anchors 都可能變)

def model_label(model_name):
    return QWEN_ASR if ENGINE == 'qwen' else f'{QWEN_ASR}+whisper-{model_name}' if ENGINE == 'hybrid' else model_name

def process(vid, item, songs, model_name, audio_dir, two_pass=False, force_song=None):
    rec = {'videoId': vid, 'title': item.get('title'), 'queueSongId': item.get('songId'),
           'matchMethod': item.get('matchMethod'), 'model': model_label(model_name), 'algo': ALGO}
    try:
        path = download(vid, audio_dir)
    except Exception as e:
        rec['error'] = f'download: {type(e).__name__}: {str(e)[:120]}'
        return rec
    try:
        tr = transcribe(path, model_name, None)          # 第一遍不給 prompt: 段落猜錯的 prompt 會把 ASR 帶歪
    except Exception as e:
        rec['error'] = f'asr: {type(e).__name__}: {str(e)[:120]}'
        return rec
    out = analyze(dict(rec), tr, item, songs, model_name, path, two_pass, force_song)
    if tr.get('alt') and out.get('grade') == 'C':
        # hybrid: Qwen 這支聽不出東西 (C) → 用同時跑好的 whisper 轉寫自己再認歌、對齊一次, 取較好的
        # (936 支裡有 66 支歌名一樣卻從 A/B 掉到 C, 例如 Qwen 只轉出 4 個字、whisper 有 57 個字)
        alt = analyze(dict(rec), tr['alt'], item, songs, model_name, path, False, force_song)
        if _rank(alt) > _rank(out):
            out = alt
            out['fallback'] = 'whisper'
    return out


def _rank(r):
    real = [a for a in r.get('anchors') or [] if not a.get('est')]
    return (r.get('grade') != 'C', bool(r.get('songId')), sum(a['score'] for a in real))


def analyze(rec, tr, item, songs, model_name, path, two_pass=False, force_song=None):
    """一份轉寫 → 認歌 → 對齊 → 評級, 結果寫進 rec"""
    guess = item.get('songId') if item.get('songId') in songs else None
    top = identify(tr['hira'], songs)
    rec['songCandidates'] = [{'songId': s, 'score': round(float(sc), 1)} for sc, s in top]
    s1 = top[0][0] if top else 0
    sid, conflict = None, False
    if force_song:
        sid = force_song
    else:
        sid = decide_song(top, guess, item.get('matchMethod'))
        conflict = bool(sid and guess and sid != guess and item.get('matchMethod') in TRUSTED_METHODS)
    rec.update(songId=sid, duration=round(float(tr['duration']), 1), transcript=tr['segments'],
               versionType=guess_version(item.get('title')), conflict=conflict)
    if not sid:
        rec.update(anchors=[], confidence=0, needsReview=['no_song'], grade='C')
        return rec
    anchors, ambiguous = align(songs[sid], tr)
    real1 = [a for a in anchors if not a.get('est')]
    mean1 = sum(a['score'] for a in real1) / len(real1) if real1 else 0
    clean = len(real1) >= 3 and mean1 >= 72 and not ambiguous and not conflict
    if two_pass and not clean:
        # (--prompt-pass 實驗用) 第二遍: 用第一遍對到的段落的歌詞當 prompt 重轉, 兩次對齊取總分高的。
        # 風險: whisper 會把 prompt 原句抄進輸出 → 分數變高但句子是錯的; 不用佇列的標題句 (lineHint) 當提示
        hint = min(a['line'] for a in real1) if real1 else 0
        try:
            tr2 = transcribe(path, model_name, lyric_prompt(songs[sid], hint))
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
        r = process(vid, it, songs, args.model, audio_dir, two_pass=args.prompt_pass)
        if r.get('error'):
            print(f'  {vid} ERROR {r["error"]}', flush=True); continue
        agg['n'] += 1
        top1 = (r.get('songCandidates') or [{}])[0].get('songId')
        agg['song_top1'] += top1 == h['songId']
        agg['song_decided'] += r.get('songId') == h['songId']
        if r.get('songId') != h['songId']:             # 對齊品質用人工歌 id 重算, 與辨識錯誤隔離
            r2 = process(vid, it, songs, args.model, audio_dir, two_pass=args.prompt_pass, force_song=h['songId'])
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
    print('\n[validate] 樣本', agg['n'], '| engine', ENGINE, '| model', QWEN_ASR if ENGINE == 'qwen' else args.model)
    print(f"  歌曲辨識 ASR top1 正確: {agg['song_top1']}/{n} ({agg['song_top1']/n:.0%})   最終判定正確: {agg['song_decided']}/{n}")
    print(f"  anchors 召回: {agg['hit']}/{agg['hum']} ({agg['hit']/max(agg['hum'],1):.0%})   精確: {agg['hit']}/{agg['auto']} ({agg['hit']/max(agg['auto'],1):.0%})")
    if dts:
        print(f"  時間誤差 中位 {dts[len(dts)//2]:.2f}s · ≤0.5s {sum(d<=.5 for d in dts)/len(dts):.0%} · ≤1.0s {sum(d<=1 for d in dts)/len(dts):.0%} · ≤2.0s {sum(d<=2 for d in dts)/len(dts):.0%}")

def write_out(out_path, data, indent=1):
    """寫 auto_anchors.json; 寫的是正式輸出 (非 shard 的自訂 --out) 時同步鏡像到 public/annotate/"""
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=indent), encoding='utf-8')
    if out_path.resolve() == OUT_F.resolve():
        PUB_F.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out_path, PUB_F)


# ---------- 合併: A/B 級寫進 shorts_anchors.json (status=auto) ----------
def merge(out_path):
    auto = json.loads(out_path.read_text(encoding='utf-8'))['items']
    anchors = json.loads(ANCHORS_F.read_text(encoding='utf-8'))
    n = skipped = dropped = 0
    mismatch = []
    for vid, r in auto.items():
        if r.get('error'):
            continue                                     # 下載 / ASR 失敗: 什麼都不改 (不是「沒把握」)
        cur = anchors.get(vid)
        if cur and cur.get('status') in ('done', 'skip'):
            continue
        if cur and cur.get('songConfirmed') and r.get('songId') != cur.get('songId'):
            mismatch.append(vid); continue               # 人工確認的歌名優先; 這份結果是別首歌 → 不套用
        if cur and cur.get('status') == 'pending' and cur.get('anchors'):
            skipped += 1; continue                       # 人工已開始打, 不覆蓋
        if not r.get('songId') or not r.get('anchors') or r.get('grade') == 'C':
            if cur and cur.get('status') == 'auto':
                # 舊引擎的建議, 新結果卻沒把握 (C / 認不出歌) → 退回手動, 不讓過時的 anchors 留在待審清單
                cur.update(anchors=[], status='pending', source='manual')
                cur.pop('autoGrade', None)
                dropped += 1
            continue
        new = {'songId': r['songId'], 'anchors': [{'t': a['t'], 'line': a['line']} for a in enforce_gap(r['anchors'])],
               'status': 'auto', 'versionType': r.get('versionType'), 'instrumental': False,
               'source': 'auto', 'autoGrade': r['grade']}
        if cur:
            # 人工填過的欄位 (版本 / 巡演 / 場次…) 不要被機器的空值洗掉 (之前整筆覆蓋, 洗掉過 5 支的 mv/acoustic)
            for k, val in cur.items():
                if k not in ('anchors', 'status', 'source', 'autoGrade') and val not in (None, '', False) and new.get(k) in (None, '', False):
                    new[k] = val
        anchors[vid] = new
        n += 1
    ANCHORS_F.write_text(json.dumps(anchors, ensure_ascii=False, indent=2), encoding='utf-8')
    shutil.copyfile(out_path, PUB_F)                                  # annotator 的 🤖 面板讀這份 (候選歌/逐字稿)
    print(f'[merge] 寫入 {n} 支 status=auto (跳過 {skipped} 支人工進行中, {dropped} 支舊建議新結果沒把握 → 退回手動) → {ANCHORS_F.name}; 建議檔同步到 {PUB_F.relative_to(ROOT)}')
    if mismatch:
        print(f'[merge] ⚠ {len(mismatch)} 支歌名已人工確認, 但機器結果是別首歌 → 沒套用。'
              f'再跑一次 --redo (同樣的 engine) 會用確認的歌名重標這幾支, 之後再 --merge: {" ".join(mismatch[:8])}{" …" if len(mismatch) > 8 else ""}')

# ---------- CLI ----------
def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--todo', action='store_true'); ap.add_argument('--ids', nargs='*')
    ap.add_argument('--validate', action='store_true'); ap.add_argument('--merge', action='store_true')
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--model', default='small')
    ap.add_argument('--audio-dir', default=str(DEFAULT_AUDIO)); ap.add_argument('--out', default=str(OUT_F))
    ap.add_argument('--prompt-pass', action='store_true', help='實驗: 對不乾淨的結果再用歌詞當 prompt 轉一遍 (有被 prompt 帶偏的風險)')
    ap.add_argument('--vad', action='store_true', help='實驗: whisper 先做 VAD 切無聲段')
    ap.add_argument('--redo', action='store_true', help='全量重標: 所有非 done/skip 且不是用目前引擎+模型跑出來的都重跑 (中斷後同一行指令可續跑)')
    ap.add_argument('--retry-model', default='medium', help='C 級再用這個模型重跑一次 (空字串=不重跑; --engine qwen 時不適用)')
    ap.add_argument('--engine', choices=['whisper', 'qwen', 'hybrid'], default='whisper',
                    help='qwen = Qwen3-ASR + ForcedAligner; hybrid = Qwen 定句子 + whisper 定時間 (建議)。'
                         '兩者都需 pip install -r requirements-qwen.txt 與 ffmpeg')
    ap.add_argument('--threads', type=int, default=4, help='每個模型的 CPU 執行緒數')
    ap.add_argument('--shard', default='', help='i/n: 只跑第 i 份 (0-based), 搭配多個行程平行; 各自用不同 --out')
    ap.add_argument('--exclude-from', default='', help='已處理過的 auto_anchors.json, 其中的 videoId 跳過')
    ap.add_argument('--combine', nargs='*', help='把多個 shard 的 out 檔合併進 --out 後結束')
    args = ap.parse_args()
    global CPU_THREADS, VAD, ENGINE
    ENGINE = args.engine
    CPU_THREADS = max(1, args.threads)
    VAD = args.vad
    out_path, audio_dir = Path(args.out), Path(args.audio_dir)
    if args.combine:
        base = json.loads(out_path.read_text(encoding='utf-8')) if out_path.exists() else {'meta': {}, 'items': {}}
        for p in args.combine:
            part = json.loads(Path(p).read_text(encoding='utf-8'))
            base['items'].update(part.get('items', {}))
        base['meta'] = {'model': 'small+medium', 'updated': time.strftime('%Y-%m-%d %H:%M'), 'count': len(base['items'])}
        write_out(out_path, base)
        print(f'[combine] 合併 {len(args.combine)} 份 → {out_path.name} 共 {len(base["items"])} 支')
        return
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
        excl = set(json.loads(Path(args.exclude_from).read_text(encoding='utf-8'))['items']) if args.exclude_from else set()
        # --redo 可中斷續跑: 已經用「同一個引擎+模型」重標過的跳過 (舊引擎的結果才重跑)
        label = model_label(args.model)
        def stale(v):
            r = out['items'].get(v)
            if r is None:
                return True
            if not args.redo:
                return False
            if r.get('model') != label:
                return True
            # 人工已確認歌名, 但這份結果是別首歌 (重標開始後才確認的) → 用確認的歌再跑一次
            h = anchors_h.get(v, {})
            if h.get('songConfirmed') and h.get('songId') != r.get('songId'):
                return True
            # 舊版演算法的結果一律重跑 (v3 的頭尾延伸 / 換時間會改到幾乎每一支; 逐字時間沒存, 只能重新轉寫)
            return r.get('algo', 1) < ALGO and not r.get('error')
        ids = [v for v in items if anchors_h.get(v, {}).get('status') not in ('done', 'skip')
               and stale(v) and v not in excl]
        ids.sort(key=lambda v: (items[v]['group'] == '__unmatched', -(items[v].get('viewCount') or 0)))
        if args.shard:
            i, n = map(int, args.shard.split('/'))
            ids = ids[i::n]
    if args.limit:
        ids = ids[:args.limit]
    print(f'[auto] 待處理 {len(ids)} 支 · engine={ENGINE} · model={model_label(args.model)} · 音訊快取 {audio_dir}', flush=True)
    def save():
        out['meta'] = {'model': args.model, 'updated': time.strftime('%Y-%m-%d %H:%M'), 'count': len(out['items'])}
        write_out(out_path, out)
    t0 = time.time()
    with ThreadPoolExecutor(1) as ex:                    # 背景序列預下載, 主執行緒同時轉寫
        futs = {v: ex.submit(download, v, audio_dir) for v in ids}
        try:
            for i, v in enumerate(ids, 1):
                try:
                    futs[v].result()
                except Exception as e:
                    err = {'videoId': v, 'error': f'download: {type(e).__name__}: {str(e)[:120]}'}
                    prev = out['items'].get(v)
                    if prev and not prev.get('error'):
                        # 下載失敗不覆蓋既有的好結果 (舊引擎的也好過沒有); 沒有新 model 標記 → 下次 --redo 會再試
                        print(f"[{i}/{len(ids)}] {v} 保留舊結果 — {err['error']}", flush=True)
                        continue
                    out['items'][v] = err
                else:
                    h = anchors_h.get(v, {})
                    forced = h.get('songId') if h.get('songConfirmed') and h.get('songId') in songs else None
                    rec = process(v, items.get(v, {'videoId': v}), songs, args.model, audio_dir,
                                  two_pass=args.prompt_pass, force_song=forced)
                    if ENGINE == 'whisper' and args.retry_model and rec.get('grade') == 'C' and not rec.get('error'):
                        # C 級 (聽不清/對不上) 用較大的模型再試一次, 取較好的
                        rec2 = process(v, items.get(v, {'videoId': v}), songs, args.retry_model, audio_dir,
                                       two_pass=args.prompt_pass, force_song=forced)
                        sc = lambda r: (bool(r.get('songId')), sum(a['score'] for a in (r.get('anchors') or []) if not a.get('est')))
                        if not rec2.get('error') and sc(rec2) > sc(rec):
                            rec = rec2
                    prev = out['items'].get(v)
                    if rec.get('error') and prev and not prev.get('error'):
                        print(f"[{i}/{len(ids)}] {v} 保留舊結果 — {rec['error']}", flush=True)
                        continue
                    out['items'][v] = rec
                r = out['items'][v]
                print(f"[{i}/{len(ids)}] {v} {r.get('grade','-')} song={r.get('songId')} anchors={len(r.get('anchors') or [])} "
                      f"conf={r.get('confidence')} {r.get('error','')} ({(time.time()-t0)/i:.1f}s/支)", flush=True)
                if i == 10 and all(out['items'].get(x, {}).get('error') for x in ids[:10]) \
                        and len({str(out['items'].get(x, {}).get('error'))[:40] for x in ids[:10]}) == 1:
                    print(f"[auto] 前 10 支全部同一個錯誤, 停止 (多半是環境問題): {out['items'][ids[0]].get('error')}", flush=True)
                    break
                if i % 5 == 0:
                    save()
        finally:
            save()
    print(f'[auto] 完成 {len(ids)} 支, 共 {(time.time()-t0)/60:.1f} 分鐘')

if __name__ == '__main__':
    main()
