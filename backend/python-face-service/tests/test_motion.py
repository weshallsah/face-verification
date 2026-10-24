import math

import numpy as np
import pytest

from app import analysis as A
from app.challenge import check_motion, check_timing
from app.config import CFG

RX, RY = 14.0, 10.0      # 1.4 x the yaw / pitch thresholds


def arc(start_deg, end_deg, n, base=(0.0, 0.0), rx=RX, ry=RY, wobble=None):
    """Poses (yaw, pitch) along an arc of an ellipse around the baseline."""
    out = []
    for k in range(n):
        t = math.radians(start_deg + (end_deg - start_deg) * k / max(n - 1, 1))
        w = 1.0 if wobble is None else wobble[k % len(wobble)]
        out.append((base[0] + rx * w * math.cos(t), base[1] + ry * w * math.sin(t)))
    return out


def run(poses, base=(0.0, 0.0), cfg=CFG):
    return check_motion(base[0], base[1], poses, cfg)


def test_full_circle_passes_in_both_directions():
    path = arc(0, 360, 25)
    assert run(path).ok and run(path).bins_reached == 8
    assert run(list(reversed(path))).ok          # order does not matter


def test_start_point_does_not_matter():
    for start in (0, 37, 100, 211):
        assert run(arc(start, start + 360, 24)).ok


def test_wobbly_oval_passes():
    assert run(arc(0, 360, 30, rx=16, ry=9, wobble=[1.0, 1.3, 0.95, 1.5, 1.1])).ok


def test_three_quarter_circle_passes():
    assert run(arc(20, 290, 14)).ok


def test_half_circle_fails():
    r = run(arc(5, 175, 12))
    assert not r.ok and r.reason == "motion_insufficient" and r.bins_reached == 4


def test_left_right_shaking_fails():
    rng = np.random.default_rng(0)
    path = [(s * 15.0, rng.uniform(-1.5, 1.5)) for s in (1, -1) * 10]
    assert not run(path).ok


def test_nodding_fails():
    rng = np.random.default_rng(1)
    path = [(rng.uniform(-1.5, 1.5), s * 11.0) for s in (1, -1) * 10]
    assert not run(path).ok


def test_tiny_movements_fail():
    r = run(arc(0, 360, 25, rx=4.0, ry=3.0))
    assert not r.ok and r.bins_reached == 0


def test_baseline_is_subtracted():
    # Head naturally turned / tilted: the circle is around (-9, 12), not around zero.
    base = (-9.0, 12.0)
    assert run(arc(0, 360, 25, base=base), base=base).ok
    # The same absolute poses measured from a zero baseline are mostly off-centre in one direction.
    assert not run(arc(0, 360, 25, base=base), base=(0.0, 0.0)).ok


def test_rule_uses_normalised_axes():
    # 10 deg of yaw and 7 deg of pitch are both exactly "one unit".
    assert run([(10.0, 0.0)]).bins_reached == 1
    assert run([(0.0, 7.0)]).bins_reached == 1
    assert run([(9.9, 0.0), (0.0, 6.9)]).bins_reached == 0


def test_thresholds_come_from_config():
    from dataclasses import replace
    assert not run(arc(0, 360, 25), cfg=replace(CFG, motion_min_bins=9)).ok
    assert run(arc(5, 175, 12), cfg=replace(CFG, motion_min_bins=4)).ok


# ---- timestamp sanity ----------------------------------------------------------------------

def timeline(neutral=(0, 200, 400), chal=(1000, 1300, 1600, 1900, 2200), ret=(2800, 2950)):
    return ([("NEUTRAL", t) for t in neutral] + [("CHALLENGE", t) for t in chal] + [("RETURN", t) for t in ret])


def test_good_timeline_passes():
    reason, duration = check_timing(timeline(), "HEAD_MOTION", CFG)
    assert reason is None and duration == 1200


@pytest.mark.parametrize("bad", [
    dict(chal=(1000, 1300, 1300, 1900, 2200)),       # repeated timestamp
    dict(chal=(1000, 1300, 1200, 1900, 2200)),       # goes backwards
    dict(neutral=(0, 400, 200)),
    dict(ret=(2950, 2800)),
])
def test_non_increasing_timestamps_are_rejected(bad):
    assert check_timing(timeline(**bad), "HEAD_MOTION", CFG)[0] == "bad_timestamps"


def test_phases_are_checked_independently():
    # CHALLENGE timestamps need not be larger than the NEUTRAL ones; only order within a phase counts.
    assert check_timing(timeline(neutral=(5000, 5200, 5400)), "HEAD_MOTION", CFG)[0] is None


def test_instant_motion_is_rejected():
    reason, duration = check_timing(timeline(chal=(1000, 1100, 1200, 1300, 1400)), "HEAD_MOTION", CFG)
    assert reason == "motion_too_fast" and duration == 400
    assert check_timing(timeline(chal=(1000, 1200, 1400, 1600, 1800)), "HEAD_MOTION", CFG)[0] is None   # exactly 800


def test_duration_rule_only_applies_to_head_motion():
    assert check_timing(timeline(chal=(1000, 1100)), "BLINK", CFG)[0] is None


# ---- planar residual (log only) -------------------------------------------------------------

# Ten face-like points in inter-eye units with depth that is NOT an affine function of (x, y).
FACE3D = np.array([
    [-0.5, 0.0, 0.00], [-0.2, 0.0, 0.05], [0.2, 0.0, 0.05], [0.5, 0.0, 0.00],
    [0.0, 0.45, 0.45], [-0.3, 0.9, 0.12], [0.3, 0.9, 0.12], [0.0, 1.5, 0.15],
    [-0.8, 0.5, -0.45], [0.8, 0.5, -0.45],
])


def project(points3d, yaw_deg, scale=300.0, offset=(320.0, 240.0)):
    t = math.radians(yaw_deg)
    x = points3d[:, 0] * math.cos(t) + points3d[:, 2] * math.sin(t)
    return np.stack([x, points3d[:, 1]], axis=1) * scale + offset


def test_tilted_flat_photo_has_near_zero_residual():
    import cv2
    neutral = project(FACE3D, 0.0)
    # Any tilt / move of a flat photo is a homography of its neutral landmarks.
    H = np.array([[0.86, 0.06, 14.0], [-0.03, 1.1, -9.0], [2e-4, 3e-4, 1.0]])
    tilted = cv2.perspectiveTransform(neutral[None], H)[0]
    assert A.planar_residual(neutral, tilted) < 1e-6


def test_rotating_3d_head_leaves_a_clearly_larger_residual():
    neutral = project(FACE3D, 0.0)
    flat = A.planar_residual(neutral, project(FACE3D * np.array([1, 1, 0]), 30.0))   # same motion, depth removed
    real = A.planar_residual(neutral, project(FACE3D, 30.0))
    assert flat < 1e-6
    assert real > 0.02 and real > 1000 * max(flat, 1e-9)
