"""參考音訊整首轉寫 (hybrid), 存快取, 可續跑"""
import sys, json, time
from pathlib import Path
sys.path.insert(0, 'scripts')
import auto_annotate as aa
KEYS = ('hira', 'char_time', 'duration', 'segments')
refs = json.load(open(Path(__file__).resolve().parent / 'reference_tracks.json'))
out_f = aa.DEFAULT_AUDIO / 'ref' / 'ref_transcripts.json'
out = json.loads(out_f.read_text()) if out_f.exists() else {}
only = set(sys.argv[1:])
aa.ENGINE = 'hybrid'
for sid, vs in refs.items():
    for v in vs:
        if v in out or (only and v not in only): continue
        t0 = time.time()
        try:
            tr = aa.transcribe(aa.download(v, aa.DEFAULT_AUDIO / 'ref'), 'small', None)
            out[v] = {'song': sid, 'qwen': {x: tr[x] for x in KEYS}, 'alt': {x: tr['alt'][x] for x in KEYS} if tr.get('alt') else None}
        except Exception as e:
            out[v] = {'song': sid, 'error': f'{type(e).__name__}: {e}'[:300]}
        out_f.write_text(json.dumps(out, ensure_ascii=False))
        print(sid, v, 'ERR ' + out[v]['error'] if 'error' in out[v] else 'ok', f'{time.time() - t0:.0f}s', flush=True)
