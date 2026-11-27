"""eval_golden 的同歌先驗: 留一法 + 不跨 split"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import eval_golden as eg   # noqa: E402


def _clip(line, **kw):
    return dict(songId='s', status='done', anchors=[{'line': line, 't': 0}], **kw)


def test_eval_prior_leave_one_out_and_same_split(monkeypatch):
    split = {'a': 'dev', 'b': 'dev', 'c': 'test'}
    monkeypatch.setattr(eg, 'split_of', lambda v: split[v])
    H = {'a': _clip(0), 'b': _clip(4), 'c': _clip(9)}
    assert eg.eval_prior(H, 's', 'a', 'dev', set()) == {4: 1.0}            # 不含自己、不含 test 的 c
    assert eg.eval_prior(H, 's', 'c', 'test', set()) == {}                  # test 只看 test, 自己排掉後沒有
    assert eg.eval_prior(H, 's', 'x', 'dev', set()) == {0: 0.5, 4: 0.5}


def test_eval_prior_fresh_does_not_see_snapshot_clips(monkeypatch):
    monkeypatch.setattr(eg, 'split_of', lambda v: 'dev')
    H = {'a': _clip(0), 'n1': _clip(4), 'n2': _clip(5), 'm': _clip(7, autoGrade='A')}
    seen = {'a'}                                                            # a 在快照裡 (= dev), n1 / n2 是新標的
    assert eg.eval_prior(H, 's', 'n1', 'fresh', seen) == {5: 1.0}          # fresh 不吃 dev、不含自己、看模型改不算
    assert eg.eval_prior(H, 's', 'a', 'dev', seen) == {}                    # dev 不吃 fresh
