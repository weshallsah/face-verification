from dataclasses import replace

from app.challenge import check_blink, check_turn
from app.config import CFG


def blink(base, peak, ret=None, cfg=CFG):
    ret = [base] if ret is None else list(ret)
    return check_blink(base, [base, peak, base], ret, cfg)


def test_blink_passes_with_clear_rise():
    r = blink(0.10, 0.60)
    assert r.ok and r.peak_idx == 1 and abs(r.metric - 0.50) < 1e-9


def test_blink_rise_below_delta_fails():
    r = blink(0.10, 0.30)          # +0.20 < 0.25
    assert not r.ok and r.reason == "blink_not_detected"


def test_blink_threshold_is_relative_to_baseline():
    # Resting score 0.45 (droopy lids). The old absolute 0.5 rule would pass a +0.06 wobble.
    assert not blink(0.45, 0.51).ok
    assert blink(0.45, 0.75).ok


def test_blink_low_resting_score_needs_only_delta():
    # The old absolute 0.5 rule would have rejected a light blink that only reaches 0.38.
    assert blink(0.05, 0.38).ok


def test_blink_eyes_must_reopen():
    r = blink(0.10, 0.70, ret=[0.55, 0.60])
    assert not r.ok and r.reason == "eyes_not_reopened"


def test_blink_return_tolerates_one_frame_caught_mid_blink():
    assert blink(0.10, 0.70, ret=[0.80, 0.12]).ok


def test_blink_return_margin_uses_baseline():
    assert blink(0.40, 0.80, ret=[0.50, 0.52]).ok          # 0.50 < 0.40 + 0.15
    assert not blink(0.40, 0.80, ret=[0.60, 0.62]).ok


def turn(challenge, base_yaw, frames, cfg=CFG):
    return check_turn(challenge, base_yaw, frames, cfg)


def test_turn_left_passes_when_nose_moves_to_subjects_left():
    r = turn("TURN_LEFT", 2.0, [(3.0, 0.0), (20.0, 0.22), (14.0, 0.15)])
    assert r.ok and r.direction_ok and r.peak_idx == 1 and abs(r.metric - 18.0) < 1e-9


def test_turn_right_passes_when_nose_moves_to_subjects_right():
    assert turn("TURN_RIGHT", 2.0, [(3.0, 0.0), (-20.0, -0.22)]).ok


def test_turn_wrong_direction_fails():
    r = turn("TURN_LEFT", 0.0, [(0.0, 0.0), (-25.0, -0.3)])
    assert not r.ok and r.reason == "wrong_direction" and r.direction_ok is False
    r = turn("TURN_RIGHT", 0.0, [(0.0, 0.0), (25.0, 0.3)])
    assert not r.ok and r.reason == "wrong_direction"


def test_turn_too_small_fails():
    r = turn("TURN_LEFT", 0.0, [(0.0, 0.0), (9.0, 0.1)])
    assert not r.ok and r.reason == "turn_too_small"


def test_turn_is_relative_to_baseline_yaw():
    # Baseline already at -8 deg: a move to +6 is a 14 deg turn even though |6| < 15.
    assert turn("TURN_LEFT", -8.0, [(-8.0, 0.0), (6.0, 0.12)]).ok
    # Small baseline: 10 deg absolute but only 8 deg of movement.
    assert not turn("TURN_LEFT", 2.0, [(2.0, 0.0), (10.0, 0.1)]).ok


def test_turn_logs_signed_peak_yaw():
    r = turn("TURN_LEFT", 1.0, [(1.0, 0.0), (-17.0, 0.2)])    # nose says left, yaw sign says negative
    assert r.ok and abs(r.peak_yaw_signed - (-18.0)) < 1e-9


def test_turn_thresholds_come_from_config():
    cfg = replace(CFG, turn_delta_deg=20.0)
    assert not turn("TURN_LEFT", 0.0, [(0.0, 0.0), (15.0, 0.2)], cfg).ok
