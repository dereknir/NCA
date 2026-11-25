#!/usr/bin/env python3
"""
local_runner.py — 本機助手: 讓 annotator 網頁上的「🧠 跑模型」在這台電腦上跑 auto_annotate

平常不在背景執行。annotator 按下按鈕 → 瀏覽器開 nca-runner://start → 系統叫起這支 (安裝見 scripts/runner/README.md)
→ 在 127.0.0.1:8771 開一個只給 annotator 用的小服務 → 網頁問環境、按跑 → 跑完推到 develop → 閒置 10 分鐘自己結束。

跑一次 =
  1. 抓最新的 develop 到獨立的工作目錄 (~/.nca-runner/worktree, git worktree; 不碰我正在寫程式的那份)
  2. auto_annotate.py --todo 看哪幾支還沒跑 (沒審完、也還沒有機器結果的)
  3. auto_annotate.py 跑那幾支 (有 Qwen + ffmpeg 用 hybrid, 沒有就 whisper), 跑完自動同錄音照抄
  4. --merge --include-c: 結果一律 status=auto 進 🤖 待審 (done / skip / 我動過的 pending 都不動)
  5. commit + push develop; 推不上去 (中間我在 annotator 存過) → 拿最新的 develop 重新合併再推
只接受 annotator 的網址 (Origin 檢查), 只做上面這件事, 不接受任何其他指令。

用法 (平常不用手動):
  .venv-qwen/bin/python scripts/local_runner.py [nca-runner://start]
環境變數 (測試用): NCA_RUNNER_REMOTE (預設 origin) / NCA_RUNNER_BRANCH (預設 develop) / NCA_RUNNER_NO_PUSH=1
"""
import json, os, re, shutil, subprocess, sys, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8771
VERSION = 1
REPO = Path(__file__).resolve().parent.parent
HOME = Path.home() / '.nca-runner'
WT = HOME / 'worktree'
LOG_F = HOME / 'runner.log'
REMOTE = os.environ.get('NCA_RUNNER_REMOTE', 'origin')
BRANCH = os.environ.get('NCA_RUNNER_BRANCH', 'develop')
NO_PUSH = os.environ.get('NCA_RUNNER_NO_PUSH') == '1'
IDLE_EXIT = 10 * 60
WIN = os.name == 'nt'
VENV_PY = REPO / '.venv-qwen' / ('Scripts/python.exe' if WIN else 'bin/python')
# annotator 會開在: 正式站 / 我的 Vercel 預覽 (nca-…-dereknirs-projects.vercel.app, 別人建不出這個網域) / 本機開發
ORIGIN_OK = re.compile(r'^(https://(nca-red|nca-[a-z0-9-]+-dereknirs-projects)\.vercel\.app|http://(localhost|127\.0\.0\.1)(:\d+)?)$')
AUTHOR = ['-c', 'user.name=derekk', '-c', 'user.email=40862245+dereknir@users.noreply.github.com']
FILES = {   # 網頁跑完要重新載入的 (從工作目錄直接給, 不用等網站重新部署)
    'auto_anchors.json': 'public/annotate/auto_anchors.json',
    'annotation_queue.json': 'public/annotate/annotation_queue.json',
    'lyrics.json': 'public/annotate/lyrics.json',
}
NO_WINDOW = 0x08000000 if WIN else 0   # Windows: 子行程不要跳出黑色視窗

HOME.mkdir(parents=True, exist_ok=True)
last_hit = time.time()
lock = threading.Lock()
env_info = None                                  # 環境檢查結果 (啟動後背景算)
job = {'state': 'idle', 'step': '', 'i': 0, 'n': 0, 'log': [], 'result': None, 'error': None, 'started': None}


def log(*a):
    line = time.strftime('%m-%d %H:%M:%S ') + ' '.join(str(x) for x in a)
    try:
        with LOG_F.open('a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass
    with lock:
        job['log'] = (job['log'] + [line])[-60:]


def run(cmd, cwd=None, check=True, on_line=None, env=None):
    """跑一個指令, 一行一行記到 log (on_line 可以順便解析進度); 失敗丟例外"""
    e = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1', **(env or {}))
    p = subprocess.Popen([str(c) for c in cmd], cwd=str(cwd or REPO), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         env=e, creationflags=NO_WINDOW)
    out = []
    for raw in p.stdout:
        line = raw.decode('utf-8', 'replace').rstrip()
        out.append(line)
        if line:
            log('  ' + line[:300])
            if on_line:
                on_line(line)
    p.wait()
    if check and p.returncode:
        raise RuntimeError(f'{Path(str(cmd[0])).name} {" ".join(str(c) for c in cmd[1:3])} … 失敗 (exit {p.returncode}): {out[-1] if out else ""}')
    return '\n'.join(out)


def git(*args, cwd=None, check=True):
    return run(['git', *args], cwd=cwd or REPO, check=check)


# ---------- 環境檢查 ----------
PROBE = r'''
import json, importlib.util as u
r = {m: bool(u.find_spec(m)) for m in ["qwen_asr", "faster_whisper", "librosa", "rapidfuzz", "pykakasi", "yt_dlp", "torch"]}
dev = "cpu"
try:
    import torch
    dev = "cuda" if torch.cuda.is_available() else "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"
except Exception:
    pass
r["device"] = dev
print(json.dumps(r))
'''


def hf_cached(name):
    hub = Path(os.environ.get('HF_HUB_CACHE') or Path(os.environ.get('HF_HOME') or Path.home() / '.cache' / 'huggingface') / 'hub')
    return (hub / ('models--' + name.replace('/', '--'))).exists()


def check_env():
    info = {'version': VERSION, 'platform': sys.platform, 'repo': str(REPO), 'missing': [], 'notes': []}
    info['git'] = bool(shutil.which('git'))
    info['venv'] = VENV_PY.exists()
    info['ffmpeg'] = bool(shutil.which('ffmpeg'))
    mods = {}
    if info['venv']:
        try:
            out = subprocess.run([str(VENV_PY), '-c', PROBE], capture_output=True, timeout=120, creationflags=NO_WINDOW)
            mods = json.loads(out.stdout.decode('utf-8', 'replace').strip().splitlines()[-1])
        except Exception as e:
            info['notes'].append(f'模型環境檢查失敗: {e}')
    info['modules'] = mods
    info['device'] = mods.get('device', 'cpu')
    base = all(mods.get(m) for m in ('faster_whisper', 'librosa', 'rapidfuzz', 'pykakasi', 'yt_dlp'))
    # 有 Qwen + ffmpeg 用 hybrid (準); 只有 whisper 也能跑, 只是比較不準
    info['engine'] = 'hybrid' if base and mods.get('qwen_asr') and info['ffmpeg'] else 'whisper' if base else None
    if not info['git']:
        info['missing'].append('git')
    if not info['venv']:
        info['missing'].append('.venv-qwen (模型環境)')
    elif not base:
        info['missing'].append('套件: ' + ', '.join(m for m in ('faster_whisper', 'librosa', 'rapidfuzz', 'pykakasi', 'yt_dlp') if not mods.get(m)))
    if info['engine'] == 'whisper':
        info['notes'].append('沒有 Qwen 或 ffmpeg, 改用 whisper (比較不準)')
    if info['engine'] == 'hybrid' and not (hf_cached('Qwen/Qwen3-ASR-1.7B') and hf_cached('Qwen/Qwen3-ForcedAligner-0.6B')):
        info['notes'].append('第一次跑會先下載 Qwen 模型 (約 6GB)')
    if info['device'] == 'cpu':
        info['notes'].append('沒有 GPU, 用 CPU 跑會比較慢')
    info['ok'] = not info['missing']
    return info


def env_bg():
    global env_info
    try:
        env_info = check_env()
        log('[env]', json.dumps({k: env_info[k] for k in ('ok', 'engine', 'device', 'missing', 'notes')}, ensure_ascii=False))
    except Exception as e:
        env_info = {'ok': False, 'missing': [f'環境檢查失敗: {e}'], 'notes': []}


# ---------- 工作目錄 (git worktree, 跟我寫程式的那份分開) ----------
def sync_worktree():
    git('fetch', '--quiet', REMOTE, BRANCH)
    ref = f'{REMOTE}/{BRANCH}'
    if not (WT / '.git').exists():
        git('worktree', 'prune', check=False)
        git('worktree', 'add', '--detach', '--force', str(WT), ref)
    else:
        git('checkout', '--quiet', '--detach', '--force', ref, cwd=WT)
        git('clean', '-fdq', cwd=WT)
    return git('rev-parse', '--short', 'HEAD', cwd=WT).strip()


def py(*args, on_line=None):
    return run([VENV_PY, *args], cwd=WT, on_line=on_line)


def todo_list(engine):
    out = py('scripts/auto_annotate.py', '--todo', '--engine', engine)
    last = [l for l in out.splitlines() if l.startswith('{')]
    return json.loads(last[-1])['todo'] if last else []


def grades(ids):
    items = json.loads((WT / 'annotation/auto_anchors.json').read_text(encoding='utf-8'))['items']
    g = {'A': 0, 'B': 0, 'C': 0, 'err': 0}
    for v in ids:
        r = items.get(v, {})
        g['err' if r.get('error') else (r.get('grade') or 'C')] += 1
    return g


def commit_push(ids, g):
    """把 auto_anchors (兩份) + shorts_anchors commit 起來推上去; 推不上去 → 拿最新的重新合併, 最多 3 次"""
    mine = json.loads((WT / 'annotation/auto_anchors.json').read_text(encoding='utf-8'))
    for attempt in range(3):
        if attempt:
            # 遠端在這段時間有新的 commit (多半是我在 annotator 存了審核): 從最新的重來, 只把這次的結果疊上去
            log(f'[push] 遠端有新變動, 拿最新的 {BRANCH} 重新合併 (第 {attempt + 1} 次)')
            sync_worktree()
            cur_f = WT / 'annotation/auto_anchors.json'
            cur = json.loads(cur_f.read_text(encoding='utf-8'))
            for v, r in mine['items'].items():
                if v not in cur['items'] or v in ids or r != cur['items'][v]:
                    cur['items'][v] = r        # 這次跑的 + 同錄音照抄更新過的 (peer 會改到未審的其他支)
            cur['meta'] = mine.get('meta', cur.get('meta'))
            txt = json.dumps(cur, ensure_ascii=False, indent=1)
            cur_f.write_text(txt, encoding='utf-8')
            (WT / 'public/annotate/auto_anchors.json').write_text(txt, encoding='utf-8')
            py('scripts/auto_annotate.py', '--merge', '--include-c')
        run([sys.executable, 'scripts/check_sync.py'], cwd=WT)
        git('add', 'annotation/auto_anchors.json', 'public/annotate/auto_anchors.json', 'annotation/shorts_anchors.json', cwd=WT)
        if not git('status', '--porcelain', '--', 'annotation', 'public/annotate', cwd=WT).strip():
            log('[push] 沒有變動, 不用推')
            return None
        host = 'Mac' if sys.platform == 'darwin' else '桌機' if WIN else sys.platform
        msg = (f'data(annotate): {host} 跑模型 {len(ids)} 支 shorts 進 🤖 待審 '
               f'(A {g["A"]} / B {g["B"]} / C {g["C"]}' + (f' / 失敗 {g["err"]}' if g['err'] else '') + ')')
        git(*AUTHOR, 'commit', '--quiet', '-m', msg, cwd=WT)
        sha = git('rev-parse', '--short', 'HEAD', cwd=WT).strip()
        if NO_PUSH:
            log('[push] NCA_RUNNER_NO_PUSH=1, 不推'); return sha
        p = subprocess.run(['git', 'push', REMOTE, f'HEAD:{BRANCH}'], cwd=str(WT), capture_output=True, creationflags=NO_WINDOW)
        for line in (p.stdout + p.stderr).decode('utf-8', 'replace').splitlines():
            log('  ' + line)
        if p.returncode == 0:
            log(f'[push] 推上 {REMOTE}/{BRANCH}: {sha}')
            return sha
    raise RuntimeError('推了 3 次都被拒絕 (遠端一直在變), 結果留在 ~/.nca-runner/worktree, 晚點再按一次')


def do_job():
    try:
        env = env_info or check_env()
        if not env.get('ok'):
            raise RuntimeError('環境不完整: ' + '、'.join(env.get('missing') or []))
        eng = env['engine']
        step('sync', f'抓最新的 {BRANCH}')
        head = sync_worktree()
        log(f'[sync] {REMOTE}/{BRANCH} @ {head}')
        step('todo', '看哪幾支還沒跑')
        ids = todo_list(eng)
        with lock:
            job['n'] = len(ids)
        if not ids:
            finish({'ran': 0, 'ids': [], 'commit': None, 'head': head}); return
        step('asr', f'跑模型 ({eng})')

        def prog(line):
            m = re.match(r'\[(\d+)/(\d+)\]', line)
            if m:
                with lock:
                    job['i'], job['n'] = int(m.group(1)), int(m.group(2))
            elif line.startswith('[peer]'):
                pm = re.match(r'\[peer\] (\d+)/(\d+)', line)
                with lock:
                    job['step'] = 'peer'; job['label'] = '同錄音照抄'
                    if pm:
                        job['i'], job['n'] = int(pm.group(1)), int(pm.group(2))
        py('scripts/auto_annotate.py', '--engine', eng, on_line=prog)
        g = grades(ids)
        step('merge', '寫進待審')
        py('scripts/auto_annotate.py', '--merge', '--include-c')
        step('push', f'推上 {BRANCH}')
        sha = commit_push(ids, g)
        finish({'ran': len(ids), 'ids': ids, 'grades': g, 'commit': sha, 'head': head})
    except Exception as e:
        log('[error]', e); log(traceback.format_exc()[-800:])
        with lock:
            job['state'] = 'error'; job['error'] = str(e)


def step(key, label):
    log(f'[{key}] {label}')
    with lock:
        job['step'] = key; job['label'] = label


def finish(result):
    log('[done]', json.dumps(result, ensure_ascii=False))
    with lock:
        job['state'] = 'done'; job['result'] = result; job['step'] = 'done'


# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def origin(self):
        o = self.headers.get('Origin') or ''
        return o if ORIGIN_OK.match(o) else None

    def head(self, code, ctype='application/json; charset=utf-8'):
        self.send_response(code)
        o = self.origin()
        if o:
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')   # Chrome: 公開網站連本機要這個
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    def json(self, code, obj):
        self.head(code)
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode('utf-8'))

    def guard(self):
        global last_hit
        last_hit = time.time()
        if not self.origin():           # 只給 annotator 用: 別的網站 (或沒有 Origin 的請求) 一律拒絕
            self.json(403, {'error': 'origin not allowed'}); return False
        return True

    def do_OPTIONS(self):
        if self.guard():
            self.head(204)

    def do_GET(self):
        if not self.guard():
            return
        path = self.path.split('?')[0]
        if path == '/status':
            with lock:
                j = {k: job[k] for k in ('state', 'step', 'i', 'n', 'result', 'error')} | {'label': job.get('label', '')}
            self.json(200, {'runner': VERSION, 'env': env_info, 'job': j})
        elif path == '/todo':
            # 不跑模型, 只看有幾支還沒跑 (會先抓最新的 develop)
            if job['state'] == 'running':
                self.json(409, {'error': 'busy'}); return
            try:
                eng = (env_info or {}).get('engine') or 'whisper'
                with lock:
                    job['state'] = 'running'; job['step'] = 'todo'; job['label'] = '看哪幾支還沒跑'
                head = sync_worktree()
                ids = todo_list(eng)
                self.json(200, {'todo': ids, 'head': head})
            except Exception as e:
                self.json(500, {'error': str(e)})
            finally:
                with lock:
                    if job['step'] == 'todo':
                        job['state'] = 'idle'; job['step'] = ''
        elif path == '/log':
            with lock:
                self.json(200, {'log': job['log']})
        elif path.startswith('/file/') and path[6:] in FILES:
            f = WT / FILES[path[6:]]
            if not f.exists():
                self.json(404, {'error': 'not found'}); return
            self.head(200)
            self.wfile.write(f.read_bytes())
        else:
            self.json(404, {'error': 'not found'})

    def do_POST(self):
        if not self.guard():
            return
        path = self.path.split('?')[0]
        if path == '/run':
            with lock:
                if job['state'] == 'running':
                    self.json(409, {'error': 'busy'}); return
                job.update(state='running', step='start', label='開始', i=0, n=0, result=None, error=None, started=time.time())
            threading.Thread(target=do_job, daemon=True).start()
            self.json(202, {'ok': True})
        elif path == '/quit':
            self.json(200, {'ok': True})
            threading.Thread(target=lambda: (time.sleep(.2), os._exit(0)), daemon=True).start()
        else:
            self.json(404, {'error': 'not found'})


def watchdog():
    while True:
        time.sleep(15)
        if job['state'] != 'running' and time.time() - last_hit > IDLE_EXIT:
            log(f'[exit] 閒置 {IDLE_EXIT // 60} 分鐘, 結束')
            os._exit(0)


def main():
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    except OSError:
        return                          # 已經有一個在跑了 (網頁會連上那一個)
    log(f'[start] 本機助手 v{VERSION} · {REPO} · 127.0.0.1:{PORT} · args={sys.argv[1:]}')
    threading.Thread(target=env_bg, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()
    srv.serve_forever()


if __name__ == '__main__':
    main()
