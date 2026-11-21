#!/usr/bin/env python3
"""
full_live_vocals.py — 完整 Live 的切點: 用人聲分離 (Demucs) 量每句「實際起音」和「唱完」→ data/full_live_vocals.json

為什麼要: 以前切點只靠人工錨點 + 句長估計:
  - 影片裡沒有下一句時 (116 段裡 74 段) 結尾用「這句平均多長」估, 拖長音的句子最後幾個字被切掉
    (例: 東京マーブル最後的 Good night, dear)
  - 錨點跟起音差一點點, 段落開頭吃到上一句的尾巴、或吃掉這句的頭
whisper 的逐字時間在 live 歌聲上誤差可達 ±1 秒 (實測比錨點還不準), 所以改看分離出來的人聲軌音量:
人聲軌在換氣時會掉到 -20 dB 以下, 起音 / 唱完的位置很清楚; 人工錨點當參考 (實測多半落在起音前 0.1–0.2 秒)。

每支影片 (長片只看那一塊前後幾秒) 存:
  on:   [[句, 起音秒數, 前一段人聲結束秒數, 換句品質], …]  有錨點的句子
        品質 2 = 換氣 ≥ 0.15 秒 / 1 = 換氣很短 / 0 = 連唱沒換氣 (起音 = 錨點附近最小聲的地方) / -1 = 影片一開頭就在唱
  tail: [句, 唱完秒數, 下一句 (或之後的人聲) 起音秒數 | null, 人聲唱到影片結束 0/1, 多唱秒數, MMS 分數]
        最後一個有錨點的句子 (影片裡沒有下一句錨點時, 結尾怎麼切):
        先用 MMS 強制對齊 (羅馬拼音歌詞 ↔ 人聲軌) 找這句唱到哪 / 下一句有沒有唱, 這句分數 ≥ 0.15 才採用;
        不然用音量判斷 (多唱秒數 > 0 = 人聲比句長多唱一大段, 多半是沒錨點的下一句, 切在預期換句附近的低點)
src/lib/fullLive.ts 拿來決定段落的開始 / 結束; 沒量到的照舊用錨點。

量哪些影片: 預設 = 現在能上架的歌排段用到的影片 (node scripts/full_live_plan.mjs);
已經量過的跳過 (--force 重量)。排段因為新的切點換了影片, 就再跑一次, 跑到沒有新影片為止。

需要 Demucs (torch CPU 版), 跟網站其他東西分開裝:
    python -m venv .venv-vocals
    .venv-vocals/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    .venv-vocals/Scripts/python -m pip install -r requirements-vocals.txt
    .venv-vocals/Scripts/python -X utf8 scripts/full_live_vocals.py [--force] [--songs nishina-u-plus,...]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import auto_annotate as AA  # noqa: E402  (音訊快取 / 下載共用)

ROOT = Path(__file__).resolve().parent.parent
FL = ROOT / 'src' / 'data' / 'full_live.json'
OUT = ROOT / 'data' / 'full_live_vocals.json'
CACHE = AA.DEFAULT_AUDIO.parent / 'nca-vocal-cache'   # 分離後的人聲音量 (調參數重跑時不用再分離)

FPS = 100             # 人聲音量每秒幾格 (10 ms)
VOICED_DB = -20.0     # 人聲軌音量 (相對整段 95 百分位) 高於這個算「有在唱」
MIN_RUN = 0.12        # 起音後至少要連續唱這麼久才算起音 (排除雜音)
MIN_GAP = 0.05        # 起音前至少要有這麼久的空檔
ON_WIN = (-0.8, 0.6)  # 在錨點前後這個範圍找起音
LINE_GAP = 0.45       # 句子結尾: 人聲停超過這麼久才算這句唱完 (字跟字之間的短停頓不算)
NEXT_FRAC = 0.75      # 唱完後的下一段人聲, 要在「錨點 + 句長 × 這個比例」之後開始才當成下一句
LONG_PAD = 8.0        # 長片: 分離那一塊前後多抓幾秒


def plan_songs(only):
    r = subprocess.run(['node', str(ROOT / 'scripts' / 'full_live_plan.mjs')], capture_output=True, check=True)
    songs = json.loads(r.stdout.decode('utf-8'))
    return [s for s in songs if not only or s['id'] in only]


_sep = None


def _key(path, window, suffix=''):
    return CACHE / (f"{Path(path).stem}_{window[0]:.1f}_{window[1]:.1f}{suffix}.npy" if window else f"{Path(path).stem}{suffix}.npy")


def _separate(path, window):
    """Demucs 分離人聲 → 存兩份快取: dB 音量包絡 (切點用) + 16 kHz 人聲軌 (MMS 對齊用)"""
    global _sep
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    from faster_whisper.audio import decode_audio
    from scipy.signal import resample_poly
    if _sep is None:
        torch.set_num_threads(8)
        _sep = get_model('htdemucs')
        _sep.eval()
    sr = _sep.samplerate
    left, right = decode_audio(str(path), sampling_rate=sr, split_stereo=True)
    if window:
        a0 = max(0.0, window[0])
        left, right = left[int(a0 * sr):int(window[1] * sr)], right[int(a0 * sr):int(window[1] * sr)]
    with torch.no_grad():
        out = apply_model(_sep, torch.tensor(np.stack([left, right]))[None], device='cpu', shifts=0, split=True,
                          overlap=0.25, progress=False)[0]
    voc = out[_sep.sources.index('vocals')].mean(0).numpy()
    hop = sr // FPS
    n = len(voc) // hop
    rms = np.sqrt((voc[:n * hop].reshape(n, hop) ** 2).mean(1))
    db = 20 * np.log10(rms + 1e-6)
    db = (db - np.percentile(db, 95)).astype(np.float32)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(_key(path, window), db)
    np.save(_key(path, window, '_stem16'), resample_poly(voc, 160, 441).astype(np.float16))


def vocal_db(path, window=None):
    """→ (人聲音量 dB 陣列 (每 1/FPS 秒一格, 相對 95 百分位), 起點秒數)"""
    if not _key(path, window).exists():
        _separate(path, window)
    return np.load(_key(path, window)), (max(0.0, window[0]) if window else 0.0)


def stem16(path, window=None):
    """→ (16 kHz 人聲軌, 起點秒數)"""
    if not _key(path, window, '_stem16').exists():
        _separate(path, window)
    return np.load(_key(path, window, '_stem16')).astype(np.float32), (max(0.0, window[0]) if window else 0.0)


# ---------- MMS 強制對齊 (羅馬拼音歌詞 ↔ 人聲軌): 判斷「這句唱到哪 / 下一句有沒有唱」 ----------
# 實測: 這句本身分數 ≥ 0.15 時結尾時間可信; 影片最開頭那一秒不準 (開頭交給錨點)
_fa = None


def _mms():
    global _fa
    if _fa is None:
        import pykakasi
        import torchaudio
        B = torchaudio.pipelines.MMS_FA
        _fa = (B.get_model(with_star=True).eval(), B.get_dict(star='*'), pykakasi.kakasi())
    return _fa


def roman(ja):
    import re
    import unicodedata
    _, D, kks = _mms()
    s = unicodedata.normalize('NFKC', ja or '')
    s = re.sub(r'[一-鿿々]+[(（]([ぁ-ゖァ-ーー]+)[)）]', r'\1', s)
    out = []
    for it in kks.convert(s):
        w = it['hepburn'].lower() if re.search(r'[぀-ヿ一-鿿]', it['orig']) else it['orig'].lower()
        out += [x for x in re.sub(r"[^a-z' ]", ' ', w).split() if x]
    return [''.join(c for c in w if c in D) for w in out if any(c in D for c in w)]


def mms_align(w, wa0, t0, t1, lines_ja, ks):
    """t0–t1 秒 (人聲軌) 對齊第 ks 句 → {句: (開始, 結束, 平均分數)}; 句子前後用 * 吸收歌詞以外的聲音"""
    import torch
    from torchaudio.functional import forced_align, merge_tokens
    fa, D, _ = _mms()
    seg = w[max(0, int((t0 - wa0) * 16000)):max(0, int((t1 - wa0) * 16000))]
    words, owner = ['*'], [None]
    for k in ks:
        rw = roman(lines_ja[k])
        words += rw + ['*']
        owner += [k] * len(rw) + [None]
    if len(seg) < 16000 or len(words) < 3:
        return {}
    with torch.inference_mode():
        em, _ = fa(torch.tensor(seg)[None])
    toks = [[D[c] for c in wd] for wd in words]
    flat = [t for wd in toks for t in wd]
    if em.shape[1] < len(flat) * 2:
        return {}
    ali, sc = forced_align(em, torch.tensor([flat], dtype=torch.int32), blank=0)
    spans = merge_tokens(ali[0], sc[0].exp())
    sec = len(seg) / em.shape[1] / 16000
    res, i = {}, 0
    for wd, k in zip(toks, owner):
        sp = spans[i:i + len(wd)]
        i += len(wd)
        if k is None or not sp:
            continue
        r = res.setdefault(k, [t0 + sp[0].start * sec, 0.0, []])
        r[1] = t0 + sp[-1].end * sec
        r[2] += [s.score for s in sp]
    return {k: (a, b, float(np.mean(c))) for k, (a, b, c) in res.items()}


def runs(voiced):
    """→ [(起, 迄)] 連續有聲的格子區間 (迄不含); 中間 < 40 ms 的小斷點先補起來"""
    v = voiced.copy()
    k = 0
    while k < len(v):
        if not v[k]:
            j = k
            while j < len(v) and not v[j]:
                j += 1
            if 0 < k and j < len(v) and j - k <= 4:
                v[k:j] = True
            k = j
        else:
            k += 1
    out, k = [], 0
    while k < len(v):
        if v[k]:
            j = k
            while j < len(v) and v[j]:
                j += 1
            out.append((k, j))
            k = j
        else:
            k += 1
    return out


def measure(short, Lj, final, path, window=None, next_hint=None, lines_ja=None):
    """Lj = 最後一個有錨點的句子大概多長 (秒); final = 它是不是整首最後一句; lines_ja = 每句歌詞 (MMS 判斷結尾用)"""
    db, a0 = vocal_db(path, window)
    R = [(a0 + s / FPS, a0 + e / FPS) for s, e in runs(db > VOICED_DB) if (e - s) / FPS >= MIN_RUN]
    clip_end = a0 + len(db) / FPS
    am = dict(short['am'])
    if next_hint is not None:                   # 長片: 那一塊的下一句, 用 end 當它的粗略位置
        am = {**am, max(am) + 1: next_hint}
    sm = np.convolve(db, np.ones(5) / 5, mode='same')           # 50 ms 平滑, 找低點用
    on = []
    for k in sorted(am):
        t = am[k]
        best = None
        for i, (s, e) in enumerate(R):
            prev_end = R[i - 1][1] if i else a0
            gap = s - prev_end
            # 起音前靜音很久 (≥ 0.3 秒) = 一定是樂句開頭, 錨點標晚一點也認 (最多 0.8 秒); 一般只認 -0.4〜+0.5
            lo = ON_WIN[0] if gap >= 0.3 else -0.4
            if not (t + lo <= s <= t + ON_WIN[1]) or gap < MIN_GAP:
                continue
            score = abs(s - (t + 0.1)) + (0.3 if s > t + 0.35 else 0) - 0.2 * min(gap, 1.0)
            if best is None or score < best[0]:
                best = (score, s, prev_end, gap)
        if best:
            _, s, prev_end, gap = best
            q = 2 if gap >= 0.15 else 1                          # 換氣夠長 / 很短
            if s - a0 < 0.06 and db[0] > VOICED_DB:
                q = -1
            on.append([k, round(s, 2), round(prev_end, 2), q])
            continue
        # 找不到換氣 = 連唱: 切在錨點附近最小聲的地方 (q = 0, 排段時盡量避開)
        f0, f1 = int((t - 0.35 - a0) * FPS), int((t + 0.2 - a0) * FPS)
        f0, f1 = max(0, f0), min(len(db), f1)
        if t - a0 < 0.25 and db[:5].max() > VOICED_DB:
            on.append([k, round(a0, 2), round(a0, 2), -1])         # 影片一開頭就在唱: 這句的頭被影片切掉了
        elif f1 > f0:
            d = a0 + (f0 + int(np.argmin(sm[f0:f1]))) / FPS
            on.append([k, round(d, 2), round(d, 2), 0])
    out = {'on': on}
    last = max(k for k, _ in short['am'])
    t = am[last]
    dur = short.get('dur') or clip_end
    if next_hint is None:
        # 影片裡最後一個有錨點的句子: 唱到哪、後面有沒有下一句的頭
        segs = [(s, e) for s, e in R if e > t + 0.1]
        nxt = None
        if not final:
            # 下一句大概在「錨點 + 句長」開始: 在 0.75–1.35 倍之間找換氣後的起音, 越接近、換氣越長越好
            # (連唱時兩句之間只停 0.2–0.3 秒, 不能只靠「停很久」判斷)
            best = None
            for i, (s, e) in enumerate(R):
                if not (t + 0.75 * Lj <= s <= t + 1.35 * Lj):
                    continue
                gap = s - (R[i - 1][1] if i else a0)
                # 換氣要夠長 (≥ 0.15 秒): 拖長音中間的顫音起伏常常只掉 0.05–0.1 秒, 不能當成下一句
                if gap < 0.15:
                    continue
                score = abs(s - (t + Lj)) - 0.5 * min(gap, 1.0)
                if best is None or score < best[0]:
                    best = (score, s)
            if best:
                nxt = best[1]
            else:                               # 預期位置沒有: 這句可能拖得比較長, 停頓夠久之後的人聲才算下一句
                end = None
                for s, e in segs:
                    if end is not None and s - end >= LINE_GAP and s >= t + 0.75 * Lj:
                        nxt = s
                        break
                    end = e if end is None else max(end, e)
        before = [e for s, e in segs if (nxt is None or s < nxt) and (not final or s < t + 15)]
        if before:
            end = max(before)
            touches = 1 if end >= min(dur, clip_end) - 0.05 else 0
            over = 0.0
            if not final and nxt is None and end > t + 1.35 * Lj + 0.5:
                # 人聲比這句該有的長度多唱了一大段 → 多半是沒標錨點的下一句接著唱 (連唱 / 觀眾合唱蓋掉換氣)
                # 切在「預期換句」附近音量最低的地方 (50 ms 平滑), 並標成沒把握 (over > 0, 排段時重罰)
                over = end - (t + 1.35 * Lj)
                f0, f1 = int((t + 0.8 * Lj - a0) * FPS), int((min(t + 1.4 * Lj, clip_end) - a0) * FPS)
                sm = np.convolve(db, np.ones(5) / 5, mode='same')
                if f1 > f0:
                    k = f0 + int(np.argmin(sm[f0:f1]))
                    nxt = a0 + k / FPS
                    end = max([e for s, e in segs if s < nxt] + [nxt - 0.05])
                    end = min(end, nxt)
            out['tail'] = [last, round(end, 2), None if nxt is None else round(nxt, 2), touches, round(over, 2), 0.0]
        if not final and lines_ja is not None:
            mt = mms_tail(path, window, db, a0, R, t, last, lines_ja, dur, clip_end)
            env = out.get('tail')
            # 音量在換氣 ≥ 0.15 秒處找到的下一句比 MMS 早 → 用音量的 (偏向不重疊; 實測 MMS 偶爾把下一句的頭算進這句)
            env_first = env and env[2] is not None and env[4] == 0 and (not mt or mt[2] is None or env[2] < mt[2] - 0.3)
            if mt and not env_first:
                out['tail'] = mt
    return out


def mms_tail(path, window, db, a0, R, t, last, lines_ja, dur, clip_end):
    """影片裡最後一個有錨點的句子 (不是整首最後一句): 用 MMS 判斷唱到哪、下一句有沒有唱
    → [句, 唱完, 下一句起音 | null, 人聲唱到影片結束 0/1, 0, 這句的 MMS 分數]; 這句分數 < 0.15 回 None (照音量判斷)
    唱完 = MMS 的句尾再沿人聲軌往後延到換氣 (≥ 0.15 秒) — MMS 常把拖長的母音提早結束; 但不超過下一句。
    下一句: MMS 分數 ≥ 0.15 才算有唱; 沒唱的話, 唱完之後再出現的人聲 (即興 / 觀眾 / 沒錨點的句子) 也切在它之前。"""
    w, wa0 = stem16(path, window)
    ks = [last] + ([last + 1] if last + 1 < len(lines_ja) else [])
    r = mms_align(w, wa0, max(wa0, t - 0.6), min(clip_end, wa0 + len(w) / 16000), lines_ja, ks)
    if last not in r or r[last][2] < 0.15:
        return None
    ej, sc = r[last][1], r[last][2]
    nm = r.get(last + 1)
    nxt = nm[0] if nm and nm[2] >= 0.15 and nm[0] >= ej - 0.05 else None
    lim = min(len(db), int((((nxt - 0.05) if nxt else clip_end) - a0) * FPS))
    sung, quiet, f = ej, 0, int((ej - a0) * FPS)
    while f < lim:
        if db[f] > VOICED_DB:
            quiet, sung = 0, a0 + (f + 1) / FPS
        else:
            quiet += 1
            if quiet >= 15:
                break
        f += 1
    sung = min(sung, (nxt - 0.05) if nxt else sung)
    if nxt is None:
        later = [s for s, e in R if s > sung + 0.15]
        if later:
            nxt = later[0]
    touches = 1 if sung >= min(dur, clip_end) - 0.05 else 0
    return [last, round(sung, 2), None if nxt is None else round(nxt, 2), touches, 0.0, round(sc, 2)]


def line_lengths(song, lyr):
    """每句大概多長: shorts 量得到的 (同一支相鄰兩句錨點差) 用 full_live.json 的 L;
    量不到的 (L 是整首中位數代用值) 改照假名字數比例估, 長句才不會被當成短句"""
    L = song['L']
    measured = set()
    for x in song['shorts']:
        if x['live'] and not x.get('long'):
            at = dict(x['am'])
            measured |= {k for k in at if k + 1 in at and 0 < at[k + 1] - at[k] < 20}
    mora = [max(1, len(h)) for _, _, h in lyr['lines']]
    rates = [L[k] / mora[k] for k in measured]
    if not rates:
        return L
    rate = float(np.median(rates))
    return [L[k] if k in measured else float(np.clip(rate * mora[k], 1.5, 15.0)) for k in range(len(L))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--songs', default='', help='只量這幾首 (逗號分隔歌曲 id)')
    ap.add_argument('--audio-dir', default=str(AA.DEFAULT_AUDIO))
    args = ap.parse_args()
    audio_dir = Path(args.audio_dir)
    only = {x for x in args.songs.split(',') if x}

    fl = {s['id']: s for s in json.loads(FL.read_text(encoding='utf-8'))['songs']}
    lyr = AA.load_songs()
    data = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    todo = []
    for ps in plan_songs(only):
        for v in dict.fromkeys(g['v'] for g in ps['segs']):
            if args.force or v not in data.get(ps['id'], {}):
                todo.append((ps['id'], v))
    print(f'[vocals] {len(todo)} 支要量', flush=True)
    for n, (sid, v) in enumerate(todo, 1):
        song = fl[sid]
        Ls = line_lengths(song, lyr[sid])
        try:
            path = AA.download(v, audio_dir)
        except Exception as e:                  # noqa: BLE001
            print(f'[vocals] {n}/{len(todo)} {sid} {v} 下載失敗: {e}', flush=True)
            continue
        res = {'on': [], 'sep': 'htdemucs'}
        for x in [x for x in song['shorts'] if x['v'] == v]:        # 長片同一首可能有好幾塊
            if x.get('long'):
                last = max(k for k, _ in x['am'])
                r = measure(x, Ls[last], last == len(Ls) - 1, path, (x['am'][0][1] - LONG_PAD, x['end'] + LONG_PAD), next_hint=x['end'])
            else:
                last = max(k for k, _ in x['am'])
                r = measure(x, Ls[last], last == len(Ls) - 1, path, lines_ja=[l['ja'] for l in song['lines']])
                if 'tail' in r:
                    res['tail'] = r['tail']
            res['on'] += r['on']
        res['on'].sort()
        data.setdefault(sid, {})[v] = res
        na = sum(len(x['am']) for x in song['shorts'] if x['v'] == v)
        print(f"[vocals] {n}/{len(todo)} {sid} {v}: 起音 {len(res['on'])}/{na}  tail {res.get('tail')}", flush=True)
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('[vocals] done', flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
