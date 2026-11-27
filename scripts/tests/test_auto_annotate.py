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
