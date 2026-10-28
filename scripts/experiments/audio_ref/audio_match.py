"""音訊對音訊: chroma 互相關找片段在參考音訊裡的位置"""
import sys, json
from pathlib import Path
import numpy as np
sys.path.insert(0, 'scripts')
import auto_annotate as aa

SR = 16000
HOP = 512                      # 32 ms
FPS = SR / HOP
FEAT_DIR = aa.DEFAULT_AUDIO / "feat"
REF_DIR = aa.DEFAULT_AUDIO / "ref"            # 參考音訊 / 轉寫 / 字幕 / 比對結果 (快取, 不進 git)
REFS_F = Path(__file__).resolve().parent / "reference_tracks.json"


def feat(path: Path):
    """chroma (12 x N), 每格 L2 正規化; 快取成 npy"""
    FEAT_DIR.mkdir(exist_ok=True)
    f = FEAT_DIR / (path.stem + '.npy')
    if f.exists():
        return np.load(f)
    import librosa
    y, _ = aa.load_16k(path)
    c = librosa.feature.chroma_stft(y=y, sr=SR, n_fft=4096, hop_length=HOP)
    n = np.linalg.norm(c, axis=0, keepdims=True)
    c = np.where(n > 1e-6, c / np.maximum(n, 1e-6), 0).astype(np.float32)
    np.save(f, c)
    return c


def xcorr(q, r, min_overlap=None):
    """所有位移下的平均 cosine 相似度。回傳 (offsets 秒, sims)。offset = 片段第 0 格對到參考的第幾秒 (可為負: 片段開頭在參考之前)"""
    Nq, Nr = q.shape[1], r.shape[1]
    min_overlap = min_overlap or min(Nq, Nr) // 2
    L = 1 << int(np.ceil(np.log2(Nq + Nr)))
    Q = np.fft.rfft(q[:, ::-1], L, axis=1); R = np.fft.rfft(r, L, axis=1)
    full = np.fft.irfft((Q * R).sum(0), L)[:Nq + Nr - 1]          # index j ↔ 位移 k = j - (Nq - 1)
    k = np.arange(Nq + Nr - 1) - (Nq - 1)
    vq = (np.linalg.norm(q, axis=0) > 0).astype(np.float32); vr = (np.linalg.norm(r, axis=0) > 0).astype(np.float32)
    cnt = np.fft.irfft(np.fft.rfft(vq[::-1], L) * np.fft.rfft(vr, L), L)[:Nq + Nr - 1]
    sims = np.where(cnt >= min_overlap, full / np.maximum(cnt, 1), -1)
    return k / FPS, sims


def best_match(q, r):
    off, s = xcorr(q, r)
    i = int(np.argmax(s))
    # 次高峰: 離最佳位移 5 秒以外 (副歌重複)
    far = np.abs(off - off[i]) > 5
    j = int(np.argmax(np.where(far, s, -1)))
    return float(off[i]), float(s[i]), float(off[j]), float(s[j])


if __name__ == '__main__':
    refs = json.load(open(REFS_F))
    H = json.load(open('annotation/shorts_anchors.json'))
    rows = []
    for v, a in H.items():
        if a.get('status') != 'done' or a.get('songId') not in refs:
            continue
        p = aa.DEFAULT_AUDIO / f'{v}.m4a'
        if not p.exists():
            continue
        q = feat(p)
        best = max((best_match(q, feat(aa.DEFAULT_AUDIO / 'ref' / f'{rv}.m4a')) + (rv,) for rv in refs[a['songId']]), key=lambda x: x[1])
        rows.append((a.get('versionType') or '-', v, a['songId'], *best))
    json.dump(rows, open(REF_DIR / 'match_done.json', 'w'))
    import collections
    by = collections.defaultdict(list)
    for r in rows:
        by[r[0]].append(r[4])
    for k, xs in sorted(by.items(), key=lambda x: -len(x[1])):
        xs = np.array(xs)
        print(f'{k:<9} {len(xs):4d} 支  相似度 中位 {np.median(xs):.2f}  P10 {np.percentile(xs, 10):.2f}  P90 {np.percentile(xs, 90):.2f}  ≥0.9: {np.mean(xs >= .9):.0%}  ≥0.8: {np.mean(xs >= .8):.0%}')
