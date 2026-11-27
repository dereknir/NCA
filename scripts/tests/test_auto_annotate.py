"""auto_annotate 對齊核心的行為測試 — 調參數 / 改演算法時先跑一次, 確認沒有悄悄改到這些行為。

  pip install pytest rapidfuzz pykakasi
  python3 -m pytest scripts/tests -q

全部用手造的歌詞與轉寫 (不需要音檔、逐字稿快取或 GPU)。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import auto_annotate as aa   # noqa: E402

# 五句互不相像的假名歌詞, 第 1、3 句是同一句副歌 (用來測重複段)
VERSES = ['あおいそらのしたで', 'かぜがふいていたね', 'きみのこえがきこえる', 'ほしをかぞえながら', 'よるのまちをあるいた']


def make_song(lines):
    ls = [(i, t, aa.to_hira(t)) for i, t in enumerate(lines)]
    return dict(id='t', title='t', lines=ls, full=''.join(h for _, _, h in ls))


def make_tr(text, cps=4.0, t0=0.0, duration=None):
    """轉寫: 每秒 cps 個假名, 逐字時間線性遞增"""
    ct = [t0 + k / cps for k in range(len(text))]
    return dict(hira=text, char_time=ct, duration=duration or (ct[-1] + 3 if ct else 0), segments=[])


# ---------- to_hira ----------
def test_to_hira_removes_punct_and_spaces():
    assert aa.to_hira('あい、 うえ！お') == 'あいうえお'


def test_to_hira_ruby_uses_reading():
    assert aa.to_hira('虚像(うそ)だよ') == 'うそだよ'


def test_to_hira_katakana_to_hiragana():
    assert aa.to_hira('カタカナ') == 'かたかな'


# ---------- align ----------
def test_align_exact_transcript_gets_every_line_on_time():
    song = make_song(VERSES)
    text = ''.join(l[2] for l in song['lines'])
    anchors, ambiguous = aa.align(song, make_tr(text))
    assert [a['line'] for a in anchors] == [0, 1, 2, 3, 4]
    assert not ambiguous
    starts, pos = [], 0
    for _i, _j, h in song['lines']:
        starts.append(pos / 4.0); pos += len(h)
    for a, t in zip(anchors, starts):
        assert a['t'] == pytest.approx(t, abs=0.01)
    assert all(not a.get('est') for a in anchors)


def test_align_middle_excerpt_only_lines_in_clip():
    song = make_song(VERSES)
    text = song['lines'][1][2] + song['lines'][2][2]
    anchors, _ = aa.align(song, make_tr(text))
    real = [a['line'] for a in anchors if not a.get('est')]
    assert real == [1, 2]
    assert anchors[0]['t'] == pytest.approx(0.0, abs=0.01)


def test_align_times_strictly_increasing_with_min_gap():
    song = make_song(VERSES)
    text = ''.join(l[2] for l in song['lines'])
    anchors, _ = aa.align(song, make_tr(text))
    ts = [a['t'] for a in anchors]
    assert all(b - a >= aa.MIN_GAP for a, b in zip(ts, ts[1:]))


def test_align_no_match_returns_empty():
    song = make_song(VERSES)
    anchors, ambiguous = aa.align(song, make_tr('ぬぬぬぬぬぬぬぬぬぬぬぬ'))
    assert anchors == [] and ambiguous is False


def test_align_repeated_chorus_is_ambiguous_and_takes_later_repeat():
    lines = ['あおいそらのしたで', 'かぜがふいていたね', 'きみのこえがきこえる', 'ほしをかぞえながら',
             'あおいそらのしたで', 'かぜがふいていたね', 'よるのまちをあるいた']
    song = make_song(lines)
    text = aa.to_hira(lines[0] + lines[1])          # 只唱副歌兩句, 第 0-1 句跟第 4-5 句一模一樣
    anchors, ambiguous = aa.align(song, make_tr(text))
    assert ambiguous
    assert {a['line'] for a in anchors if not a.get('est')} == {4, 5}   # 人工多選後面那次 (shorts 多剪最後一段副歌)


# ---------- enforce_gap ----------
def test_enforce_gap_drops_est_over_real():
    a = [{'t': 1.0, 'line': 0, 'score': 50, 'est': True}, {'t': 1.3, 'line': 1, 'score': 80}]
    assert [x['line'] for x in aa.enforce_gap(a)] == [1]


def test_enforce_gap_keeps_higher_score_when_both_real():
    a = [{'t': 1.0, 'line': 0, 'score': 90}, {'t': 1.3, 'line': 1, 'score': 70}]
    assert [x['line'] for x in aa.enforce_gap(a)] == [0]


def test_enforce_gap_leaves_spaced_anchors_alone():
    a = [{'t': 1.0, 'line': 0, 'score': 90}, {'t': 2.0, 'line': 1, 'score': 70}]
    assert aa.enforce_gap(a) == a


# ---------- _fix_times ----------
def test_fix_times_spreads_stacked_anchors():
    a = [{'t': 2.0, 'line': 0, 'score': 80}, {'t': 2.0, 'line': 1, 'score': 50},
         {'t': 6.0, 'line': 2, 'score': 80}]
    out = aa._fix_times(a, 20.0)
    assert [x['t'] for x in out] == pytest.approx([2.0, 4.0, 6.0])
    assert out[1].get('est')


def test_fix_times_stack_without_room_keeps_first_only():
    a = [{'t': 19.0, 'line': 0, 'score': 80}, {'t': 19.0, 'line': 1, 'score': 50}]
    assert [x['line'] for x in aa._fix_times(a, 19.5)] == [0]


def test_fix_times_drops_line_starting_at_very_end():
    a = [{'t': 1.0, 'line': 0, 'score': 80}, {'t': 19.6, 'line': 1, 'score': 80}]
    assert [x['line'] for x in aa._fix_times(a, 20.0)] == [0]


# ---------- _retime (hybrid: whisper 時間優先) ----------
def test_retime_uses_whisper_and_interpolates_between():
    a = [{'t': 1.0, 'line': 0}, {'t': 3.0, 'line': 1}, {'t': 5.0, 'line': 2}]
    out = aa._retime(a, {0: 1.5, 2: 5.5})
    assert [x['t'] for x in out] == pytest.approx([1.5, 3.0, 5.5])   # 第 1 句留 Qwen 時間 (沒有倒退)


def test_retime_without_whisper_match_is_noop():
    a = [{'t': 1.0, 'line': 0}, {'t': 3.0, 'line': 1}]
    assert [x['t'] for x in aa._retime(a, {})] == [1.0, 3.0]


def test_retime_resolves_backwards_time_by_interpolating():
    a = [{'t': 1.0, 'line': 0}, {'t': 3.0, 'line': 1}, {'t': 5.0, 'line': 2}]
    out = aa._retime(a, {0: 1.0, 2: 5.0, 1: 0.8})          # whisper 第 1 句倒退到第 0 句之前
    ts = [x['t'] for x in out]
    assert ts == sorted(ts)


# ---------- analyze 評級 ----------
def _analyze(song, text):
    return aa.analyze({}, make_tr(text), {}, {'t': song}, 'small', None, False, 't')


def test_analyze_clean_clip_is_grade_a():
    song = make_song(VERSES)
    r = _analyze(song, ''.join(l[2] for l in song['lines']))
    assert r['grade'] == 'A' and r['needsReview'] == []


def test_analyze_nothing_matched_is_grade_c():
    song = make_song(VERSES)
    r = _analyze(song, 'ぬぬぬぬぬぬぬぬぬぬぬぬ')
    assert r['grade'] == 'C' and 'anchors<2' in r['needsReview']


def test_analyze_repeated_chorus_is_not_grade_a():
    lines = VERSES[:4] + VERSES[:2] + VERSES[4:]
    song = make_song(lines)
    r = _analyze(song, aa.to_hira(lines[0] + lines[1]))
    assert 'ambiguous_start' in r['needsReview'] and r['grade'] != 'A'



def test_align_repeated_chorus_last_repeat_not_penalised_by_song_end():
    # 歌以副歌結尾: X 副 副' Y 副 副'; 片段 = 副歌 + 講話。最後一次副歌後面沒有歌詞可延伸,
    # 但「盲猜一句」不能算接得上 → 仍取最後那次
    lines = [VERSES[2], VERSES[0], VERSES[1], VERSES[3], VERSES[0], VERSES[1]]
    anchors, ambiguous = aa.align(make_song(lines), make_tr(VERSES[0] + VERSES[1] + 'ありがとうございました'))
    assert ambiguous
    assert [a['line'] for a in anchors] == [4, 5]


def test_extend_edges_est0_only_adds_text_matched_lines():
    lines = make_song([VERSES[2], VERSES[0], VERSES[1], VERSES[3]])['lines']
    hira = VERSES[0] + VERSES[1] + 'ありがとうございました'
    chain = [(1, 0, 100.0), (2, len(VERSES[0]), 100.0)]
    assert [c[0] for c in aa._extend_edges(lines, hira, chain, est=0)] == [1, 2]
