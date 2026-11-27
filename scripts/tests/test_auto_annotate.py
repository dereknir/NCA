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


def test_retime_head_line_follows_next_whisper_shift():
    # 開頭那句 whisper 沒對到、Qwen 時間又太晚 → 換完跟後一句擠在 MIN_GAP 內;
    # 要跟著後一句的 (whisper − Qwen) 位移往前移, 不能留在原地被 enforce_gap 丟掉
    a = [{'t': 0.96, 'line': 0, 'score': 62}, {'t': 2.16, 'line': 1, 'score': 80}, {'t': 8.2, 'line': 2, 'score': 100}]
    out = aa.enforce_gap(aa._retime(a, {1: 1.12, 2: 8.36}))
    assert [x['line'] for x in out] == [0, 1, 2]
    assert [x['t'] for x in out] == pytest.approx([0.0, 1.12, 8.36])


def test_retime_tail_line_keeps_qwen_time():
    a = [{'t': 1.0, 'line': 0}, {'t': 2.0, 'line': 1}]
    out = aa._retime(a, {0: 1.8})
    assert [x['t'] for x in out] == pytest.approx([1.8, 2.0])      # 結尾那句不跟著移 (交給 enforce_gap)


def test_retime_head_shift_capped_when_whisper_offset_too_large():
    # whisper 第 1 句對到 0 秒、Qwen 是 7.36 秒 (位移 −7.36, 多半 whisper 對錯地方): 開頭那句不能跟著移到 0 秒
    a = [{'t': 2.72, 'line': 29}, {'t': 7.36, 'line': 30}, {'t': 12.0, 'line': 31}]
    out = aa._retime(a, {30: 0.0, 31: 12.1})
    assert out[0]['t'] == pytest.approx(2.72)


def test_retime_head_shift_skipped_when_still_crowded_after_clamp():
    # 往前移會跑到 0 秒之前, 夾到 0 之後仍跟後一句擠在 MIN_GAP 內 → 不移
    a = [{'t': 0.5, 'line': 0}, {'t': 1.4, 'line': 1}]
    out = aa._retime(a, {1: 0.3})
    assert out[0]['t'] == pytest.approx(0.5)


def test_retime_several_head_lines_stay_ordered():
    # 開頭兩句都沒有 whisper: 第 0 句不衝突留原時間, 第 1 句衝突 → 有前鄰居就內插 (不走開頭位移)
    a = [{'t': 0.5, 'line': 0, 'score': 60}, {'t': 1.4, 'line': 1, 'score': 60}, {'t': 2.6, 'line': 2, 'score': 90}]
    out = aa.enforce_gap(aa._retime(a, {2: 1.9}))
    assert [x['line'] for x in out] == [0, 1, 2]
    assert [x['t'] for x in out] == pytest.approx([0.5, 1.2, 1.9])


# ---------- _whisper_lead (hybrid: Qwen 漏轉開頭、whisper 有轉到) ----------
def _q(*rows):
    return [dict(line=l, t=t, score=80, **({'est': True} if e else {})) for l, t, e in rows]


def test_whisper_lead_adds_text_matched_lines_before_qwen_chain():
    qa = _q((3, 15.2, 0), (4, 19.9, 0), (5, 26.4, 0))
    aw = _q((0, 0.0, 0), (1, 4.1, 1), (2, 11.4, 0), (3, 15.2, 0), (4, 19.9, 0))
    out = aa._whisper_lead(qa, aw)
    assert [(a['line'], a['t']) for a in out] == [(0, 0.0), (1, 4.1), (2, 11.4), (3, 15.2), (4, 19.9), (5, 26.4)]
    assert out[1].get('est')                                       # whisper 的估計句照樣標 est


# ---------- _whisper_est (hybrid: Qwen 的估計句改用 whisper 估的時間) ----------
def test_whisper_est_uses_whisper_estimate_for_qwen_estimate_line():
    # Qwen 整句吃掉第 33 句, 估計句擠到下一句的位置; whisper 同一句也是估的, 但位置對
    qa = _q((31, 5.5, 0), (32, 9.3, 0), (33, 13.9, 1), (34, 14.3, 0))
    aw = _q((31, 5.4, 0), (32, 9.2, 0), (33, 10.6, 1), (34, 13.9, 0))
    tw = {a['line']: a['t'] for a in aw if not a.get('est')}
    assert aa._whisper_est(qa, aw, tw) == {33: 10.6}
    out = aa._retime(qa, {**tw, **aa._whisper_est(qa, aw, tw)})
    assert [a['t'] for a in out] == [5.4, 9.2, 10.6, 13.9]
    assert out[2].get('est')                                       # 還是估計句, 審核時照樣提醒


def test_whisper_est_needs_two_shared_real_lines():
    qa = _q((31, 5.5, 0), (32, 9.3, 1), (33, 13.9, 0))
    aw = _q((31, 5.4, 0), (32, 7.0, 1), (33, 20.0, 1))
    tw = {a['line']: a['t'] for a in aw if not a.get('est')}
    assert aa._whisper_est(qa, aw, tw) == {}                       # 只有 1 句共同實對句: 可能是另一段, 不用


def test_whisper_est_never_overrides_qwen_real_line():
    qa = _q((1, 1.0, 0), (2, 4.0, 0), (3, 8.0, 0))
    aw = _q((1, 1.1, 0), (2, 4.1, 0), (3, 6.0, 1))
    tw = {a['line']: a['t'] for a in aw if not a.get('est')}
    assert aa._whisper_est(qa, aw, tw) == {}


def test_whisper_lead_skips_when_lead_lines_are_only_estimates():
    qa = _q((3, 10.0, 0), (4, 14.0, 0))
    aw = _q((1, 2.0, 1), (2, 6.0, 1), (3, 10.0, 0), (4, 14.0, 0))
    assert [a['line'] for a in aa._whisper_lead(qa, aw)] == [3, 4]


def test_whisper_lead_skips_when_whisper_chose_another_section():
    # whisper 對到的是另一段 (跟 Qwen 沒有共同的實對句): 不補, 免得兩段混在一起
    qa = _q((20, 0.2, 0), (21, 7.5, 0), (22, 15.7, 0))
    aw = _q((8, 0.0, 0), (9, 6.1, 0), (10, 13.8, 1))
    assert [a['line'] for a in aa._whisper_lead(qa, aw)] == [20, 21, 22]


def test_whisper_lead_skips_lines_not_earlier_in_time():
    # whisper 前面的句子時間不在 Qwen 第一句之前 (MIN_GAP 內 / 之後) → 不補
    qa = _q((3, 1.0, 0), (4, 5.0, 0))
    aw = _q((2, 0.6, 0), (3, 1.0, 0), (4, 5.0, 0))
    assert [a['line'] for a in aa._whisper_lead(qa, aw)] == [3, 4]


# ---------- _extend_edges 往前延伸 ----------
def test_extend_edges_stops_guessing_when_nothing_earlier_matches():
    lines = make_song(VERSES)['lines']
    pre = 'ぬ' * (len(VERSES[0]) + len(VERSES[1]) + len(VERSES[2]))
    hira = pre + VERSES[3] + VERSES[4]
    chain = [(3, len(pre), 100.0), (4, len(pre) + len(VERSES[3]), 100.0)]
    assert [c[0] for c in aa._extend_edges(lines, hira, chain)] == [2, 3, 4]   # 只盲猜 EXT_EST 句


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


def test_align_tied_chorus_uses_short_lines_around_it():
    # 副 副' 後面接的短句 (< MIN_LINE, 不參與對齊) 兩次不一樣: 第一次接 そして, 第二次接 もうね。
    # 延伸句數平手, 但整段轉寫明顯比較像第一次 → 改選第一次 (不再固定取後面那次)
    lines = [VERSES[2], VERSES[0], VERSES[1], 'そして', VERSES[3], VERSES[0], VERSES[1], 'もうね', VERSES[4]]
    song = make_song(lines)
    text = VERSES[0] + VERSES[1] + 'そして'
    anchors, ambiguous = aa.align(song, make_tr(text))
    assert ambiguous
    assert {a['line'] for a in anchors if not a.get('est')} == {1, 2}
    # 不用這條規則時是取後面那次
    old = aa.TIE_WIN_MARGIN
    try:
        aa.TIE_WIN_MARGIN = 0
        anchors0, _ = aa.align(song, make_tr(text))
    finally:
        aa.TIE_WIN_MARGIN = old
    assert {a['line'] for a in anchors0 if not a.get('est')} == {5, 6}


def test_window_ratio_ignores_text_past_song_end():
    # 最後一次副歌之後歌詞沒了: 超出歌尾的轉寫不算, 不能因此比前一次低
    lines = make_song([VERSES[2], VERSES[0], VERSES[1], VERSES[3], VERSES[0], VERSES[1]])['lines']
    hira = VERSES[0] + VERSES[1] + 'ありがとう'
    first = [(1, 0, 100.0), (2, len(VERSES[0]), 100.0)]
    last = [(4, 0, 100.0), (5, len(VERSES[0]), 100.0)]
    assert aa._window_ratio(lines, hira, last) == 100
    assert aa._window_ratio(lines, hira, first) < 100


def test_extend_edges_est0_only_adds_text_matched_lines():
    lines = make_song([VERSES[2], VERSES[0], VERSES[1], VERSES[3]])['lines']
    hira = VERSES[0] + VERSES[1] + 'ありがとうございました'
    chain = [(1, 0, 100.0), (2, len(VERSES[0]), 100.0)]
    assert [c[0] for c in aa._extend_edges(lines, hira, chain, est=0)] == [1, 2]


def test_whisper_lead_noop_on_empty_or_first_line_zero():
    assert aa._whisper_lead([], _q((0, 0.0, 0))) == []
    qa = _q((0, 1.0, 0), (1, 4.0, 0))
    assert aa._whisper_lead(qa, []) is qa
    assert [a['line'] for a in aa._whisper_lead(qa, _q((0, 1.0, 0), (1, 4.0, 0)))] == [0, 1]


def test_whisper_lead_keeps_leading_estimate_and_does_not_mutate_whisper():
    qa = _q((3, 10.0, 0), (4, 14.0, 0))
    aw = _q((1, 0.0, 1), (2, 5.0, 0), (3, 10.0, 0), (4, 14.0, 0))
    out = aa._whisper_lead(qa, aw)
    assert [(a['line'], bool(a.get('est'))) for a in out] == [(1, True), (2, False), (3, False), (4, False)]
    out[0]['t'] = 99
    assert aw[0]['t'] == 0.0                                      # 補進來的是複本


def test_whisper_lead_only_drops_crowded_line_not_whole_lead():
    # whisper 前一句落在 Qwen 第一句 MIN_GAP 內 → 只丟那句, 更前面的照補 (時間仍遞增、行號不重複)
    qa = _q((5, 10.0, 0), (6, 14.0, 0))
    aw = _q((3, 2.0, 0), (4, 9.7, 0), (5, 10.0, 0), (6, 14.0, 0))
    out = aa._whisper_lead(qa, aw)
    assert [a['line'] for a in out] == [3, 5, 6]
    ts = [a['t'] for a in out]
    assert ts == sorted(ts) and all(b - a >= aa.MIN_GAP for a, b in zip(ts, ts[1:]))


def test_whisper_lead_needs_two_shared_real_lines():
    # 只有 1 句共同實對句: 證據太少 (Qwen 原本會是 C, 補完會變 A 直接進待審) → 不補
    qa = _q((3, 10.0, 0), (4, 14.0, 1))
    aw = _q((1, 2.0, 0), (2, 5.0, 0), (3, 10.0, 0), (4, 14.0, 0))
    assert [a['line'] for a in aa._whisper_lead(qa, aw)] == [3, 4]


def test_align_hybrid_wires_whisper_lead(monkeypatch):
    # Qwen 只轉到第 2 句之後 (10 秒起), whisper 從頭轉到: hybrid 結果要補上 0、1 句; 關掉 WHISPER_LEAD 就不補
    song = make_song(VERSES)
    hira = [l[2] for l in song['lines']]
    ct = []
    for k, h in enumerate(hira):
        ct += [k * 5.0 + j * 0.25 for j in range(len(h))]
    w = dict(hira=''.join(hira), char_time=ct, duration=ct[-1] + 3, segments=[])
    n = len(hira[0]) + len(hira[1])
    q = dict(hira=w['hira'][n:], char_time=ct[n:], duration=w['duration'], segments=[], alt=w)
    monkeypatch.setattr(aa, 'WHISPER_LEAD', False)
    assert [a['line'] for a in aa.align(song, dict(q))[0]] == [2, 3, 4]
    monkeypatch.setattr(aa, 'WHISPER_LEAD', True)
    anchors, _ = aa.align(song, dict(q))
    assert [a['line'] for a in anchors] == [0, 1, 2, 3, 4]
    assert [a['t'] for a in anchors] == pytest.approx([0, 5, 10, 15, 20])


# ---------- 「這不是單曲」偵測 ----------
OTHER = ['あめのにおいがした', 'とおくのでんしゃのおと', 'ねむれないよるに', 'しろいいきをはいた', 'まどのそとはゆき']


def _songs():
    a = make_song(VERSES); a['id'] = 'a'
    b = make_song(OTHER); b['id'] = 'b'
    return {'a': a, 'b': b}


@pytest.mark.parametrize('title', ['FES ありがとうございました!', 'tour thank you!!', 'new photo', 'グッズ出ます', 'Your lucky nishina track',
                                   'WILD BUNCH FEST. 2026 #ライブ', 'きょうもきょうとて #フェス', '#tour2026', 'osanpo2 #にしな',
                                   'RUSH BALL 2026、ありがとうございました', 'にしなfes', 'Thank you for GLICO LIVE', 'nishina new goods',
                                   'ツアー初日', 'ＦＥＳ　ありがとう', 'ＴＯＵＲ ２０２６', 'summer tours', 'THANKYOU!!'])
def test_nonsong_title_hits_event_words(title):
    # 活動字樣單獨出現就算; # 只拿掉符號 (#フェス 還是算); 前後是假名 / 數字也要對得到
    songs = _songs()
    assert aa.nonsong_signals(title, [[{'text': ''.join(VERSES)}]], 'a', songs) == ['title']


@pytest.mark.parametrize('title', ['new song MV', 'our feeling in someday #newmusic', 'Feeling in Sapporo #live', 'Manifesto live',
                                   'heavy smoke #nishina #live #shorts', '東京マーブル #ライブ', 'festive mood', 'tourist',
                                   'lucky girl', 'goodsound', 'thanks', 'ｆｅｓｔｉｖｅ', 'touring', 'thank your', ''])
def test_nonsong_title_does_not_hit_real_song_titles(title):
    # live / ライブ 單獨不算; 字界: manifesto / festive / tourist / goodsound 不能中; feeling in 不再算
    songs = _songs()
    assert aa.nonsong_signals(title, [[{'text': ''.join(VERSES)}]], 'a', songs) == []


def test_nonsong_foreign_text_from_other_song():
    songs = _songs()
    segs = [{'text': t} for t in VERSES[:2] + OTHER * 2]   # 大半是另一首歌的詞 → 拼盤 / 回顧
    assert aa.nonsong_signals('', [segs], 'a', songs) == ['foreign']
    assert aa.nonsong_signals('', [None, segs], 'a', songs) == ['foreign']   # 任一份轉寫命中就算


def test_nonsong_short_clip_with_misheard_tail_is_not_flagged():
    # 短片段: 本曲的詞 + 尾巴一小段剛好像別首歌 → 不能只靠一個短尾巴就判成「不是單曲」
    songs = _songs()
    segs = [{'text': t} for t in VERSES[:3]] + [{'text': OTHER[0]}]
    assert aa.nonsong_signals('', [segs], 'a', songs) == []


def test_nonsong_edge_inputs():
    songs = _songs()
    assert aa.nonsong_signals(None, [None], 'a', songs) == []
    assert aa.nonsong_signals('', [[{'text': None}, None]], 'a', songs) == []
    assert aa.nonsong_signals('', [[{'text': ''.join(OTHER) * 3}]], 'zz', songs) == []


def test_apply_nonsong_grades_c_and_respects_force_song():
    songs = _songs()
    base = dict(songId='a', grade='A', needsReview=[])
    out = aa.apply_nonsong(dict(base), {'title': 'new photo'}, songs, [{'segments': []}])
    assert out['grade'] == 'C' and 'not_single_song' in out['needsReview'] and out['nonSong'] == ['title']
    assert out['gradeBeforeNonsong'] == 'A'
    kept = aa.apply_nonsong(dict(base), {'title': 'new photo'}, songs, [{'segments': []}], force_song='a')
    assert kept['grade'] == 'A' and 'nonSong' not in kept


def test_nonsong_windows_merge_short_tail():
    segs = [{'text': 'あ' * 20}, {'text': 'い' * 15}]
    assert [len(w) for w in aa._windows(segs, 16)] == [16, 19]
    assert [len(w) for w in aa._windows([{'text': 'あ' * 32}], 16)] == [16, 16]
    assert aa._windows([{'text': 'あ' * 5}], 16) == ['あ' * 5]


# ---------- 補套偵測 (舊結果不重跑 ASR) ----------
def _stored(title, grade='A', with_asr=True):
    r = dict(videoId='x', title=title, songId='a', grade=grade, needsReview=[], anchors=[{'t': 1.0, 'line': 0, 'score': 90}],
             transcript=[{'text': ''.join(VERSES)}])
    if with_asr:
        r['asr'] = dict(songId='a', grade=grade, needsReview=[], anchors=r['anchors'], confidence=90)
        r['grade'] = 'A'                                       # 照抄升過級的外層
    return r


def test_backfill_flags_asr_base_and_outer():
    songs = _songs()
    r = _stored('nishina new photo', grade='B')
    assert aa.backfill_nonsong(r, songs) is True
    assert r['grade'] == 'C' and r['asr']['grade'] == 'C' and r['nonSong'] == ['title']
    assert r['needsReview'] == ['not_single_song'] and r['asr']['needsReview'] == ['not_single_song']
    assert aa.backfill_nonsong(r, songs) is False            # 跑第二次不重複加
    assert r['needsReview'] == ['not_single_song']


def test_backfill_without_asr_field():
    songs = _songs()
    r = _stored('tour thank you', with_asr=False)
    assert aa.backfill_nonsong(r, songs) is True and r['grade'] == 'C' and 'asr' not in r


def test_backfill_leaves_real_songs_errors_and_confirmed_songs():
    songs = _songs()
    r = _stored('heavy smoke #live')
    assert aa.backfill_nonsong(r, songs) is False and r['grade'] == 'A' and 'nonSong' not in r
    e = {'videoId': 'x', 'title': 'new photo', 'error': 'download: x'}
    assert aa.backfill_nonsong(e, songs) is False and 'grade' not in e
    f = _stored('new photo')
    assert aa.backfill_nonsong(f, songs, force_song='a') is False and f['grade'] == 'A'


def test_backfill_all_skips_done(tmp_path, monkeypatch):
    import json
    songs = _songs()
    out = tmp_path / 'auto.json'
    out.write_text(json.dumps({'meta': {}, 'items': {'p': dict(_stored('new photo'), videoId='p'),
                                                     'd': dict(_stored('new photo'), videoId='d'),
                                                     's': dict(_stored('heavy smoke'), videoId='s')}}), encoding='utf-8')
    anc = tmp_path / 'anchors.json'
    anc.write_text(json.dumps({'d': {'status': 'done', 'songId': 'a'}}), encoding='utf-8')
    monkeypatch.setattr(aa, 'ANCHORS_F', anc)
    monkeypatch.setattr(aa, 'load_songs', lambda: songs)
    assert aa.backfill_all(out) == 1
    items = json.loads(out.read_text(encoding='utf-8'))['items']
    assert items['p']['grade'] == 'C' and items['d']['grade'] == 'A' and items['s']['grade'] == 'A'


# ---------- whisper 引擎: 標題命中不觸發大模型重跑 ----------
def test_needs_retry_skips_title_hits(monkeypatch):
    monkeypatch.setattr(aa, 'ENGINE', 'whisper')
    assert aa.needs_retry({'grade': 'C'}, 'medium') is True
    assert aa.needs_retry({'grade': 'C', 'nonSong': ['title']}, 'medium') is False
    assert aa.needs_retry({'grade': 'C', 'nonSong': ['title', 'foreign']}, 'medium') is False
    assert aa.needs_retry({'grade': 'C', 'nonSong': ['foreign']}, 'medium') is True   # 轉寫判的: 換大模型可能不一樣
    assert aa.needs_retry({'grade': 'B'}, 'medium') is False
    assert aa.needs_retry({'grade': 'C'}, '') is False
    assert aa.needs_retry({'grade': 'C', 'error': 'asr: x'}, 'medium') is False
    monkeypatch.setattr(aa, 'ENGINE', 'hybrid')
    assert aa.needs_retry({'grade': 'C'}, 'medium') is False


# ---------- 同錄音照抄不能把「不是單曲」升回 A/B ----------
def test_peer_regrade_keeps_not_single_song_c():
    pytest.importorskip('numpy')
    import peer_anchors as pa
    r = {'grade': 'C', 'needsReview': ['not_single_song', 'event_title']}
    pa.regrade(r, 0.95)
    assert r == {'grade': 'C', 'needsReview': ['not_single_song', 'event_title']}
    pa.regrade(r, 0.5)
    assert r['grade'] == 'C'


def test_peer_regrade_still_upgrades_normal_results():
    pytest.importorskip('numpy')
    import peer_anchors as pa
    r = {'grade': 'C', 'needsReview': ['low_align', 'event_title']}
    pa.regrade(r, 0.95)
    assert r == {'grade': 'A', 'needsReview': ['event_title']}
    r = {'grade': 'C', 'needsReview': ['low_align']}
    pa.regrade(r, 0.5)
    assert r['grade'] == 'B'
    r = {'grade': 'A', 'needsReview': []}
    pa.regrade(r, 0.5)
    assert r['grade'] == 'A'


# ---------- eval_nonsong 第 1 部分: 看 ASR 原本的結果、兩份轉寫 ----------
def test_eval_nonsong_reads_asr_base_and_both_transcripts():
    import eval_nonsong as en
    songs = _songs()
    r = dict(_stored('', grade='C'), transcript=[{'text': ''.join(VERSES)}])
    assert en.asr_base(r) is r['asr'] and en.asr_base(r)['grade'] == 'C'      # 外層被照抄升成 A, 要看 ASR 的 C
    plain = {'grade': 'B'}
    assert en.asr_base(plain) is plain
    mix = [{'text': t} for t in VERSES[:2] + OTHER * 2]
    cache = {'x': {'qwen': {'segments': [{'text': ''.join(VERSES)}]}, 'alt': {'segments': mix}}}
    trs = en.stored_transcripts('x', r, cache)
    assert len(trs) == 3 and trs[2] is mix
    assert aa.nonsong_signals('', trs, 'a', songs) == ['foreign']          # 只有 whisper 那份是拼盤也要抓到
    assert aa.nonsong_signals('', en.stored_transcripts('y', r, cache), 'a', songs) == []


def test_apply_nonsong_title_hit_without_song():
    # ASR 認不出歌也要記標題命中, 不然同錄音照抄配到歌後會被升成 A
    songs = _songs()
    out = aa.apply_nonsong(dict(songId=None, grade='C', needsReview=['no_song']), {'title': 'nishina tour 2026'}, songs, [None])
    assert out['needsReview'] == ['no_song', 'not_single_song'] and out['nonSong'] == ['title']
    plain = aa.apply_nonsong(dict(songId=None, grade='C', needsReview=['no_song']), {'title': 'heavy smoke'}, songs, [None])
    assert plain['needsReview'] == ['no_song'] and 'nonSong' not in plain


def test_peer_no_song_title_hit_not_lifted_to_a():
    pytest.importorskip('numpy')
    import peer_anchors as pa
    songs = _songs()
    r = {'title': 'nishina tour 2026', 'songId': None, 'grade': 'C', 'needsReview': ['no_song'], 'transcript': [],
         'asr': {'songId': None, 'grade': 'C', 'needsReview': ['no_song'], 'anchors': [], 'confidence': 0}}
    assert aa.backfill_nonsong(r, songs) is True
    for k in pa.KEEP:                                        # 照抄每次從 asr 重算
        r[k] = r['asr'][k]
    r['songId'] = 'a'                                        # 已審的同錄音片段給了歌名
    pa.regrade(r, 0.95)
    assert r['grade'] == 'C' and 'not_single_song' in r['needsReview']


def test_backfill_propagates_flag_to_outer_upgraded_by_old_peer():
    songs = _songs()
    r = _stored('heavy smoke')                                # 標題不中: 旗子是之前 (例如轉寫那條) 標的
    r['asr'].update(grade='C', needsReview=['not_single_song'], nonSong=['foreign'])
    assert r['grade'] == 'A' and r['needsReview'] == []
    assert aa.backfill_nonsong(r, songs) is True
    assert r['grade'] == 'C' and r['needsReview'] == ['not_single_song'] and r['nonSong'] == ['foreign']
    assert aa.backfill_nonsong(r, songs) is False


def test_backfill_clears_title_flag_when_rule_no_longer_hits():
    songs = _songs()
    r = _stored('new photo', grade='B')
    aa.backfill_nonsong(r, songs)
    assert r['asr']['gradeBeforeNonsong'] == 'B'
    r['title'] = 'heavy smoke'                                # 規則 / 標題改了, 不再命中
    assert aa.backfill_nonsong(r, songs) is True
    assert r['asr']['grade'] == 'B' and r['asr']['needsReview'] == [] and 'gradeBeforeNonsong' not in r['asr']
    assert r['needsReview'] == [] and 'nonSong' not in r


def test_backfill_keeps_flags_it_cannot_recheck():
    songs = _songs()
    # 轉寫那條命中的 (另一份轉寫沒存) 不還原; 沒有 gradeBeforeNonsong 的舊標記也不還原
    r = _stored('heavy smoke', grade='B')
    r['asr'].update(grade='C', needsReview=['not_single_song'], nonSong=['title', 'foreign'], gradeBeforeNonsong='B')
    r.update(grade='C', needsReview=['not_single_song'])
    assert aa.backfill_nonsong(r, songs) is False and r['asr']['grade'] == 'C'
    o = _stored('heavy smoke', grade='B')
    o['asr'].update(grade='C', needsReview=['not_single_song'], nonSong=['title'])
    o.update(grade='C', needsReview=['not_single_song'])
    assert aa.backfill_nonsong(o, songs) is False and o['grade'] == 'C'


def test_merge_skips_not_single_song_even_with_include_c(tmp_path, monkeypatch):
    import json
    out = tmp_path / 'auto.json'
    ok = dict(songId='a', grade='A', needsReview=[], anchors=[{'t': 1.0, 'line': 0, 'score': 90}], versionType=None)
    out.write_text(json.dumps({'meta': {}, 'items': {
        'ns': dict(ok, needsReview=['not_single_song']),           # 等級被別的路徑弄成 A 也不能寫進去
        'old': dict(ok, grade='C', needsReview=['not_single_song']),
        'ok': dict(ok)}}), encoding='utf-8')
    anc = tmp_path / 'anchors.json'
    anc.write_text(json.dumps({'old': {'songId': 'a', 'anchors': [{'t': 1, 'line': 0}], 'status': 'auto', 'source': 'auto', 'autoGrade': 'A'}}), encoding='utf-8')
    monkeypatch.setattr(aa, 'ANCHORS_F', anc)
    monkeypatch.setattr(aa, 'PUB_F', tmp_path / 'pub.json')
    monkeypatch.setattr(aa, 'ROOT', tmp_path)
    for include_c in (False, True):
        aa.merge(out, include_c=include_c)
        H = json.loads(anc.read_text(encoding='utf-8'))
        assert 'ns' not in H and H['ok']['status'] == 'auto'
        assert H['old']['status'] == 'pending' and H['old']['anchors'] == []   # 舊的機器建議退回手動


# ---------- process() 整條: 補開頭之後才判非單曲 ----------
def test_process_hybrid_lead_then_nonsong_keeps_grade_after_lead(tmp_path, monkeypatch):
    # Qwen 只轉到第 3、4 句, 前後夾雜訊 (認歌分數 <50 → 只有 2 句時是 B), whisper 從頭轉到 → 補開頭變 A;
    # 標題是巡演字樣 → 最後 C, gradeBeforeNonsong 要記補開頭之後的 A (不是 Qwen 自己的 B)
    songs = _songs()
    hira = [l[2] for l in songs['a']['lines']]
    ct = []
    for k, h in enumerate(hira):
        ct += [k * 5.0 + j * 0.25 for j in range(len(h))]
    w = dict(hira=''.join(hira), char_time=ct, duration=40.0, segments=[{'t': 0.0, 'text': ''.join(VERSES)}])
    n = len(hira[0]) + len(hira[1]) + len(hira[2])
    junk = 'ぬ' * 30
    q = dict(hira=junk + w['hira'][n:] + junk,
             char_time=[j * 0.4 for j in range(len(junk))] + ct[n:] + [25.0 + j * 0.2 for j in range(len(junk))],
             duration=40.0, segments=[{'t': 15.0, 'text': ''.join(VERSES[3:])}])
    calls = []
    monkeypatch.setattr(aa, 'ENGINE', 'hybrid')
    monkeypatch.setattr(aa, 'download', lambda vid, d: calls.append(vid) or tmp_path / f'{vid}.m4a')
    monkeypatch.setattr(aa, 'transcribe', lambda path, m, prompt=None: dict(q, alt=dict(w)))
    item = {'title': 'nishina tour 2026', 'songId': 'a', 'matchMethod': 'hashtag'}
    monkeypatch.setattr(aa, 'NONSONG_CHECK', False)
    plain = aa.process('x', item, songs, 'small', tmp_path)
    assert [a['line'] for a in plain['anchors']][:3] == [0, 1, 2] and plain['grade'] == 'A'
    monkeypatch.setattr(aa, 'WHISPER_LEAD', False)
    assert aa.process('x', item, songs, 'small', tmp_path)['grade'] == 'B'   # 沒補開頭是 B (確認這支真的靠補開頭升級)
    monkeypatch.setattr(aa, 'WHISPER_LEAD', True)
    monkeypatch.setattr(aa, 'NONSONG_CHECK', True)
    r = aa.process('x', item, songs, 'small', tmp_path)
    assert calls == ['x'] * 3 and not r.get('error')
    assert r['grade'] == 'C' and 'not_single_song' in r['needsReview'] and r['nonSong'] == ['title']
    assert r['gradeBeforeNonsong'] == 'A'
    assert r['anchors'] == plain['anchors']                                  # 只降級, anchors 不動
    # 歌名已確認 (force_song) 不套
    assert 'not_single_song' not in aa.process('x', item, songs, 'small', tmp_path, force_song='a')['needsReview']


# ---------- peer_anchors.apply 整條: 照抄不把 not_single_song 升回 A/B ----------
def test_peer_apply_keeps_not_single_song_c(tmp_path, monkeypatch):
    np = pytest.importorskip('numpy')
    import json
    import peer_anchors as pa
    songs = _songs()
    anchors = [{'t': 1.0 + 2.5 * k, 'line': k, 'score': 80} for k in range(5)]
    rec = dict(songId='a', duration=12.8, transcript=[{'text': ''.join(VERSES)}], anchors=[dict(a) for a in anchors[:2]],
               confidence=60, versionType=None)
    out = tmp_path / 'auto.json'
    out.write_text(json.dumps({'meta': {}, 'items': {
        # 轉寫那條判的 (標題不中, 補套偵測不會再標一次) — 只剩 regrade 擋著
        'ns': dict(rec, title='heavy smoke', grade='C', needsReview=['not_single_song'], nonSong=['foreign'], gradeBeforeNonsong='B'),
        'ok': dict(rec, title='heavy smoke', grade='C', needsReview=['low_align'])}}), encoding='utf-8')
    anc = tmp_path / 'anchors.json'
    anc.write_text(json.dumps({'ref': {'songId': 'a', 'status': 'done', 'anchors': [{'t': a['t'], 'line': a['line']} for a in anchors]}}),
                   encoding='utf-8')
    # 三支是同一段錄音 (chroma 一模一樣, 12.8 秒)
    c = np.random.default_rng(0).random((12, 400)).astype(np.float32)
    c /= np.linalg.norm(c, axis=0, keepdims=True)
    m = c.mean(1) / np.linalg.norm(c.mean(1))
    monkeypatch.setattr(pa, 'load_feats', lambda vids: ({v: c for v in vids}, {v: m for v in vids}))
    monkeypatch.setattr(aa, 'ANCHORS_F', anc)
    monkeypatch.setattr(aa, 'load_songs', lambda: songs)
    assert pa.apply(out) == 2
    items = json.loads(out.read_text(encoding='utf-8'))['items']
    assert items['ok']['grade'] == 'A' and items['ok']['peer']['coverage'] >= 0.9     # 一般的照樣升級
    ns = items['ns']
    assert ns['peer'] and len(ns['anchors']) > 2                                        # anchors 照抄了
    assert ns['grade'] == 'C' and 'not_single_song' in ns['needsReview']
    assert ns['asr']['grade'] == 'C' and 'not_single_song' in ns['asr']['needsReview']
    assert ns['asr']['gradeBeforeNonsong'] == 'B'
    # 再跑一次 (從 asr 重算) 也一樣
    pa.apply(out)
    ns = json.loads(out.read_text(encoding='utf-8'))['items']['ns']
    assert ns['grade'] == 'C' and 'not_single_song' in ns['needsReview']


def test_backfill_confirmed_song_clears_foreign_flag():
    # 歌名已人工確認: process 本來就不套非單曲偵測, 舊的 foreign 旗也要還原 (不然一直卡 C)
    songs = _songs()
    r = _stored('heavy smoke', grade='B')
    r['asr'].update(grade='C', needsReview=['not_single_song'], nonSong=['foreign'], gradeBeforeNonsong='B')
    r.update(grade='C', needsReview=['not_single_song'], nonSong=['foreign'])
    assert aa.backfill_nonsong(r, songs, force_song='a') is True
    assert r['asr']['grade'] == 'B' and r['grade'] == 'B' and r['needsReview'] == [] and 'nonSong' not in r
    # 沒確認歌名時照舊不動 (轉寫那條只存一份轉寫, 沒辦法重判)
    o = _stored('heavy smoke', grade='B')
    o['asr'].update(grade='C', needsReview=['not_single_song'], nonSong=['foreign'], gradeBeforeNonsong='B')
    o.update(grade='C', needsReview=['not_single_song'])
    assert aa.backfill_nonsong(o, songs) is False and o['grade'] == 'C'


def test_merge_dropped_by_merge_can_come_back(tmp_path, monkeypatch):
    # merge 因為非單曲把舊建議退回手動 → 之後規則放寬、評級還原, 下一次 merge 要能再放回待審;
    # 人工按「退回手動」的 (沒有 autoDropped) 照舊不動
    import json
    ok = dict(songId='a', grade='A', needsReview=[], anchors=[{'t': 1.0, 'line': 0, 'score': 90}], versionType=None)
    old = {'songId': 'a', 'anchors': [{'t': 1, 'line': 0}], 'status': 'auto', 'source': 'auto', 'autoGrade': 'A', 'tour': 't1'}
    anc = tmp_path / 'anchors.json'
    anc.write_text(json.dumps({'x': dict(old), 'h': {'songId': 'a', 'anchors': [], 'status': 'pending', 'source': 'manual'}}), encoding='utf-8')
    monkeypatch.setattr(aa, 'ANCHORS_F', anc)
    monkeypatch.setattr(aa, 'PUB_F', tmp_path / 'pub.json')
    monkeypatch.setattr(aa, 'ROOT', tmp_path)
    out = tmp_path / 'auto.json'
    out.write_text(json.dumps({'meta': {}, 'items': {'x': dict(ok, grade='C', needsReview=['not_single_song']), 'h': dict(ok)}}), encoding='utf-8')
    aa.merge(out)
    H = json.loads(anc.read_text(encoding='utf-8'))
    assert H['x']['status'] == 'pending' and H['x']['autoDropped'] is True and H['h']['status'] == 'pending'
    out.write_text(json.dumps({'meta': {}, 'items': {'x': dict(ok), 'h': dict(ok)}}), encoding='utf-8')
    aa.merge(out)
    H = json.loads(anc.read_text(encoding='utf-8'))
    assert H['x']['status'] == 'auto' and H['x']['autoGrade'] == 'A' and 'autoDropped' not in H['x'] and H['x']['tour'] == 't1'
    assert H['h']['status'] == 'pending' and H['h']['source'] == 'manual'          # 人工退回的不覆蓋
    # 退回之後人工已經開始打點 / 確認歌名 → 不覆蓋
    for extra in ({'anchors': [{'t': 2, 'line': 1}]}, {'songConfirmed': True}):
        anc.write_text(json.dumps({'x': dict({'songId': 'a', 'anchors': [], 'status': 'pending', 'source': 'manual', 'autoDropped': True}, **extra)}), encoding='utf-8')
        aa.merge(out)
        assert json.loads(anc.read_text(encoding='utf-8'))['x']['status'] == 'pending'


def test_merge_dropped_but_touched_by_human_is_kept(tmp_path, monkeypatch):
    # autoDropped 留著但看得出人工動過 (舊版頁面沒清旗標): 歸到 __others / 清空歌名 / 盲標中 → merge 不覆蓋
    import json
    ok = dict(songId='a', grade='A', needsReview=[], anchors=[{'t': 1.0, 'line': 0, 'score': 90}], versionType=None)
    monkeypatch.setattr(aa, 'PUB_F', tmp_path / 'pub.json')
    monkeypatch.setattr(aa, 'ROOT', tmp_path)
    out = tmp_path / 'auto.json'
    out.write_text(json.dumps({'meta': {}, 'items': {'x': dict(ok)}}), encoding='utf-8')
    anc = tmp_path / 'anchors.json'
    monkeypatch.setattr(aa, 'ANCHORS_F', anc)
    base = {'songId': 'a', 'anchors': [], 'status': 'pending', 'source': 'manual', 'autoDropped': True}
    for extra in ({'songId': '__others'}, {'songId': None}, {'blind': True}, {'blindAborted': True}, {'source': 'auto'}):
        anc.write_text(json.dumps({'x': dict(base, **extra)}), encoding='utf-8')
        aa.merge(out)
        assert json.loads(anc.read_text(encoding='utf-8'))['x']['status'] == 'pending', extra


def test_hybrid_whisper_tie_does_not_change_timing():
    # Qwen 沒有歧義 (片段從副歌前一句唱起, 只接得上第一次); whisper 只聽到副歌, 平手。
    # 歌詞窗判斷只該改「選哪段」: 不能讓 whisper 那份改選到同一段, 進而把 Qwen 的時間換成 whisper 的
    lines = [VERSES[2], VERSES[0], VERSES[1], 'そして', VERSES[3], VERSES[0], VERSES[1], 'もうね', VERSES[4]]
    song = make_song(lines)
    q = make_tr(VERSES[2] + VERSES[0] + VERSES[1] + 'そして')
    w = make_tr(VERSES[0] + VERSES[1] + 'そして', t0=5.0)
    alone, _ = aa.align(song, dict(q))
    anchors, ambiguous = aa.align(song, dict(q, alt=w))
    assert not ambiguous
    assert [(a['line'], a['t']) for a in anchors] == [(a['line'], a['t']) for a in alone]
    # whisper 自己當主轉寫時 (Qwen 是 C 改用 whisper) 照樣用歌詞窗判斷
    assert {a['line'] for a in aa.align(song, dict(w))[0] if not a.get('est')} == {1, 2}


@pytest.mark.parametrize('lines', [
    [VERSES[0], VERSES[1], VERSES[2], VERSES[3], VERSES[0], VERSES[1]],      # 頭サビ + 最後一次副歌
    [VERSES[0], VERSES[1], VERSES[2], VERSES[0], VERSES[1], VERSES[3]],      # 頭サビ + 中段副歌
])
def test_window_ratio_noise_before_head_chorus_does_not_favor_it(lines):
    # 片段前面有歡呼被轉成假名: 超出歌頭的那段不能不計分, 不然頭サビ會拿 100 被改選
    ls = make_song(lines)['lines']
    second = lines.index(VERSES[0], 1)
    hira = 'わーきゃー' + VERSES[0] + VERSES[1]
    first = [(0, 5, 100.0), (1, 5 + len(VERSES[0]), 100.0)]
    later = [(second, 5, 100.0), (second + 1, 5 + len(VERSES[0]), 100.0)]
    assert aa._window_ratio(ls, hira, first) < 100
    assert aa._window_ratio(ls, hira, first) <= aa._window_ratio(ls, hira, later)


def test_retime_whisper_estimate_yields_to_real_whisper_line():
    # whisper 估的句子擠到下一句真的對到字的時間: 讓位的是估的那句, 不能把真的對到的 8.1 改成內插
    a = _q((1, 1.0, 0), (2, 4.0, 1), (3, 8.0, 0), (4, 12.0, 0))
    out = aa._retime(a, {1: 1.1, 2: 7.8, 3: 8.1, 4: 12.1}, low={2})
    assert out[2]['t'] == 8.1 and out[0]['t'] == 1.1 and out[3]['t'] == 12.1
    assert 1.1 < out[1]['t'] < 8.1


def test_hybrid_whisper_follows_qwen_when_qwen_tie_flipped():
    # Qwen、whisper 都平手, Qwen 被歌詞窗改選第一次副歌; whisper 要跟著選同一段, 時間才換得到 whisper 的
    lines = [VERSES[2], VERSES[0], VERSES[1], 'そして', VERSES[3], VERSES[0], VERSES[1], 'もうね', VERSES[4]]
    song = make_song(lines)
    text = VERSES[0] + VERSES[1] + 'そして'
    q = make_tr(text)
    q['alt'] = make_tr(text, t0=0.5)
    anchors, _ = aa.align(song, q)
    real = [a for a in anchors if not a.get('est')]
    assert [a['line'] for a in real] == [1, 2]
    assert real[0]['t'] == pytest.approx(0.5) and real[1]['t'] == pytest.approx(0.5 + len(VERSES[0]) / 4.0)
