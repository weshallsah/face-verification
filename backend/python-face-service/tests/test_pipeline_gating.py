"""Phase-aware gating, driven through analyse_frames with fake models.

Each fake frame is a one-byte payload holding the frame id; cv2.imdecode is patched to turn it
into an image whose [0, 0, 0] pixel is that id, and every fake model looks the id up in a
per-test scenario.
"""
from dataclasses import replace

import numpy as np
import pytest

from app import analysis as A
from app import pipeline as P
from app.config import CFG

BASE_VEC = np.random.default_rng(0).normal(size=512)
NEUTRAL3, CHAL5, RET2 = ["NEUTRAL"] * 3, ["CHALLENGE"] * 5, ["RETURN"] * 2
STABLE_IDS = (0, 1, 2, 8, 9)
CHALLENGE_IDS = (3, 4, 5, 6, 7)


class Scenario:
    """Per-frame specs by index. Defaults describe a clean neutral frame."""

    def __init__(self, phases, ts_step=100):
        self.phases = phases
        self.ts_step = ts_step
        self.spec = [dict(faces=1, size=200, blink=0.1, yaw=0.0, pitch=0.0, nose_dx=0.0, occlusion="clear",
                          blur=300.0, brightness=120.0, vec=BASE_VEC) for _ in phases]
        self.occlusion_calls = []

    def frames(self):
        return [P.Frame(bytes([k]), ph, self.ts_step * k) for k, ph in enumerate(self.phases)]


class FakeDetector:
    def __init__(self, sc):
        self.sc = sc

    def detect(self, img, max_num=0):
        s = self.sc.spec[int(img[0, 0, 0])]
        if s["faces"] == 0:
            return np.zeros((0, 5)), np.zeros((0, 5, 2))
        boxes = np.array([[10, 10, 10 + s["size"], 10 + s["size"], 0.99]] * s["faces"], dtype=float)
        kps = np.zeros((s["faces"], 5, 2))
        kps[:, 0, 0], kps[:, 1, 0], kps[:, 2, 0] = 40, 80, 60 + s["nose_dx"] * 40
        return boxes, kps


class FakeLandmarker:
    def __init__(self, sc):
        self.sc = sc

    def analyse(self, img):
        s = self.sc.spec[int(img[0, 0, 0])]
        return {"blendshapes": {"eyeBlinkLeft": s["blink"], "eyeBlinkRight": s["blink"]},
                "yaw": s["yaw"], "pitch": s["pitch"]}


class FakeRecognizer:
    def __init__(self, sc):
        self.sc = sc

    def get_feat(self, aligned):
        return self.sc.spec[int(aligned[0, 0, 0])]["vec"]


class FakeModels:
    liveness = None
    occlusion = None

    def __init__(self, sc):
        self.detector, self.recognizer = FakeDetector(sc), FakeRecognizer(sc)


@pytest.fixture
def run(monkeypatch):
    import cv2
    monkeypatch.setattr(cv2, "imdecode", lambda buf, flag: np.full((8, 8, 3), buf[0], np.uint8))
    monkeypatch.setattr(A, "align", lambda img, kps: np.full((112, 112, 3), img[0, 0, 0], np.uint8))

    def _run(sc, challenge, cfg=CFG, prompt_ts=0):
        def quality(crop):
            s = sc.spec[int(crop[0, 0, 0])]
            return {"blur": s["blur"], "brightness": s["brightness"]}

        def occlusion(models, crop):
            k = int(crop[0, 0, 0])
            sc.occlusion_calls.append(k)
            return sc.spec[k]["occlusion"], 1.0

        monkeypatch.setattr(A, "image_quality", quality)
        monkeypatch.setattr(A, "occlusion_class", occlusion)
        trace = {}
        try:
            result = P.analyse_frames(FakeModels(sc), FakeLandmarker(sc), cfg, challenge,
                                      sc.frames(), trace, prompt_ts)
            return result, None, trace
        except P.Outcome as o:
            return None, o, trace
    return _run


def blink_scenario():
    sc = Scenario(NEUTRAL3 + CHAL5 + RET2)
    sc.spec[5]["blink"] = 0.7            # peak at index 5 -> client ts 500
    return sc


def test_clean_blink_is_accepted_and_traced(run):
    result, outcome, trace = run(blink_scenario(), "BLINK", prompt_ts=100)
    assert outcome is None and result[0].shape == (512,)
    assert trace["challenge_metric"] == pytest.approx(0.6)
    assert trace["client_challenge_ms"] == 400
    assert trace["frames_used"] == 10


def test_closed_eye_challenge_frame_does_not_trigger_occlusion(run):
    sc = blink_scenario()
    sc.spec[5]["occlusion"] = "sunglasses"      # what the occlusion model might say about closed eyes
    _, outcome, _ = run(sc, "BLINK")
    assert outcome is None
    assert not set(sc.occlusion_calls) & set(CHALLENGE_IDS)      # never run on CHALLENGE frames
    assert set(sc.occlusion_calls) == set(STABLE_IDS)


def test_occlusion_on_neutral_frame_still_retries(run):
    sc = blink_scenario()
    sc.spec[1]["occlusion"] = "sunglasses"
    _, outcome, _ = run(sc, "BLINK")
    assert (outcome.verdict, outcome.reason) == ("RETRY", "sunglasses")


def test_turned_challenge_frame_does_not_trigger_face_too_small(run):
    sc = Scenario(NEUTRAL3 + CHAL5 + RET2)
    for k in CHALLENGE_IDS:
        sc.spec[k].update(size=60, yaw=20.0, nose_dx=0.25)      # 60px < min_face_px=120
    _, outcome, trace = run(sc, "TURN_LEFT")
    assert outcome is None
    assert trace["challenge_direction_ok"] is True
    assert trace["peak_yaw_signed"] == pytest.approx(20.0)


def test_small_face_in_neutral_frame_is_still_rejected(run):
    sc = blink_scenario()
    sc.spec[0]["size"] = 60
    _, outcome, _ = run(sc, "BLINK")
    assert outcome.reason == "face_too_small"


def test_one_missing_challenge_frame_is_tolerated_two_are_not(run):
    sc = blink_scenario()
    sc.spec[3]["faces"] = 0
    assert run(sc, "BLINK")[1] is None
    sc.spec[4]["faces"] = 0
    assert run(sc, "BLINK")[1].reason == "face_lost"


def test_missed_blink_is_retry_by_default_spoof_when_configured(run):
    sc = Scenario(NEUTRAL3 + CHAL5 + RET2)
    _, outcome, trace = run(sc, "BLINK")
    assert (outcome.verdict, outcome.reason) == ("RETRY", "blink_not_detected")
    assert trace["challenge_metric"] == pytest.approx(0.0)
    _, outcome, _ = run(sc, "BLINK", cfg=replace(CFG, challenge_fail_is_spoof=True))
    assert outcome.verdict == "REJECTED_SPOOF"


def test_challenge_frames_never_feed_the_embedding(run):
    sc = blink_scenario()
    other = np.random.default_rng(1).normal(size=512)
    for k in CHALLENGE_IDS:
        sc.spec[k]["vec"] = BASE_VEC * 0.9 + other * 0.4        # similar enough to pass the 0.38 check
    (emb, _), outcome, _ = run(sc, "BLINK")
    ref = BASE_VEC / np.linalg.norm(BASE_VEC)
    assert outcome is None and float(emb @ ref) == pytest.approx(1.0, abs=1e-5)


def test_different_person_in_challenge_frames_is_spoof(run):
    sc = blink_scenario()
    sc.spec[5]["vec"] = np.random.default_rng(7).normal(size=512)       # cosine ~0 with the neutral mean
    _, outcome, _ = run(sc, "BLINK")
    assert (outcome.verdict, outcome.reason) == ("REJECTED_SPOOF", "face_changed_during_session")


@pytest.mark.parametrize("field,value,reason", [
    ("brightness", 20.0, "too_dark"),
    ("brightness", 240.0, "too_bright"),
    ("blur", 5.0, "too_blurry"),
])
def test_quality_failures_get_specific_reasons(run, field, value, reason):
    sc = blink_scenario()
    for k in STABLE_IDS:
        sc.spec[k][field] = value
    _, outcome, _ = run(sc, "BLINK")
    assert (outcome.verdict, outcome.reason) == ("RETRY", reason)


def test_smiling_neutral_frames_report_not_neutral(run, monkeypatch):
    sc = blink_scenario()
    orig = FakeLandmarker.analyse

    def smiling(self, img):
        info = orig(self, img)
        if int(img[0, 0, 0]) in STABLE_IDS:
            info["blendshapes"]["mouthSmileLeft"] = 0.8
        return info
    monkeypatch.setattr(FakeLandmarker, "analyse", smiling)
    _, outcome, _ = run(sc, "BLINK")
    assert outcome.reason == "not_neutral"


def test_eyebrow_squint_and_blink_scores_no_longer_block_neutral():
    info = {"blendshapes": {"browDownLeft": 0.9, "browInnerUp": 0.8, "eyeSquintLeft": 0.7, "eyeBlinkLeft": 0.5},
            "yaw": 3.0, "pitch": 2.0}
    assert A.is_neutral(info, CFG)


def test_wrong_phase_counts_are_rejected(run):
    sc = Scenario(["NEUTRAL"] + CHAL5 + RET2)
    assert run(sc, "BLINK")[1].reason == "bad_frame_count"


# ---- HEAD_MOTION ---------------------------------------------------------------------------

CHAL8 = ["CHALLENGE"] * 8
MOTION_IDS = tuple(range(3, 11))


def motion_scenario(radius=1.5, ts_step=300):
    """3 NEUTRAL, 8 CHALLENGE on a circle (radius in threshold units), 2 RETURN."""
    sc = Scenario(NEUTRAL3 + CHAL8 + RET2, ts_step=ts_step)
    for n, k in enumerate(MOTION_IDS):
        t = 2 * np.pi * n / 8
        sc.spec[k].update(yaw=radius * 10.0 * np.cos(t), pitch=radius * 7.0 * np.sin(t))
    return sc


def test_head_motion_circle_is_accepted_and_traced(run):
    result, outcome, trace = run(motion_scenario(), "HEAD_MOTION")
    assert outcome is None and result[0].shape == (512,)
    assert trace["motion_bins_reached"] == 8
    assert trace["motion_max_dyaw"] == pytest.approx(15.0)
    assert trace["motion_duration_ms"] == 7 * 300
    assert trace["frames_used"] == 13


def test_angled_challenge_frames_skip_occlusion_size_and_neutral_checks(run):
    sc = motion_scenario()
    for k in MOTION_IDS:
        sc.spec[k].update(size=60, occlusion="sunglasses")                    # small, "occluded", and well off-axis
        sc.spec[k]["vec"] = BASE_VEC * 0.9 + np.random.default_rng(1).normal(size=512) * 0.3
    _, outcome, _ = run(sc, "HEAD_MOTION")
    assert outcome is None
    assert not set(sc.occlusion_calls) & set(MOTION_IDS)


def test_angled_challenge_frames_are_not_held_to_the_neutral_gate(run, monkeypatch):
    sc = motion_scenario()
    orig = FakeLandmarker.analyse

    def open_mouth(self, img):
        info = orig(self, img)
        if int(img[0, 0, 0]) in MOTION_IDS:
            info["blendshapes"]["jawOpen"] = 0.9        # would fail not_neutral on a NEUTRAL frame
        return info
    monkeypatch.setattr(FakeLandmarker, "analyse", open_mouth)
    assert run(sc, "HEAD_MOTION")[1] is None


def test_turned_head_is_still_not_a_valid_neutral_frame(run):
    sc = motion_scenario()
    for k in range(13):                                 # whole session at yaw +25: the motion itself is fine ...
        sc.spec[k]["yaw"] += 25.0
    _, outcome, _ = run(sc, "HEAD_MOTION")             # ... but NEUTRAL / RETURN frames must be within 15 deg
    assert (outcome.verdict, outcome.reason) == ("RETRY", "not_neutral")


def test_small_motion_is_retry_motion_insufficient(run):
    _, outcome, trace = run(motion_scenario(radius=0.4), "HEAD_MOTION")
    assert (outcome.verdict, outcome.reason) == ("RETRY", "motion_insufficient")
    assert trace["motion_bins_reached"] == 0


def test_motion_baseline_is_the_neutral_pose(run):
    sc = motion_scenario()
    for k in range(13):          # a head that rests turned 12 deg and tilted -5 deg (still inside the 15 deg neutral gate)
        sc.spec[k]["yaw"] += 12.0
        sc.spec[k]["pitch"] -= 5.0
    assert run(sc, "HEAD_MOTION")[1] is None


def test_instant_motion_is_rejected_as_spoof(run):
    _, outcome, trace = run(motion_scenario(ts_step=50), "HEAD_MOTION")        # 8 frames over 350 ms
    assert (outcome.verdict, outcome.reason) == ("REJECTED_SPOOF", "motion_too_fast")
    assert trace["motion_duration_ms"] == 350


def test_non_increasing_timestamps_are_rejected_as_spoof(run):
    sc = motion_scenario()
    frames = sc.frames()
    sc.frames = lambda: frames[:5] + [frames[5]._replace(ts=frames[4].ts)] + frames[6:]
    _, outcome, _ = run(sc, "HEAD_MOTION")
    assert (outcome.verdict, outcome.reason) == ("REJECTED_SPOOF", "bad_timestamps")


def test_different_person_while_moving_is_spoof(run):
    sc = motion_scenario()
    sc.spec[6]["vec"] = np.random.default_rng(5).normal(size=512)
    _, outcome, _ = run(sc, "HEAD_MOTION")
    assert (outcome.verdict, outcome.reason) == ("REJECTED_SPOOF", "face_changed_during_session")


def test_motion_similarity_floor_is_lower_than_the_turn_floor(run):
    sc = motion_scenario()
    # cosine to the neutral mean ~0.36: passes the 0.35 motion floor, would fail the 0.38 blink/turn floor
    rng = np.random.default_rng(3)
    other = rng.normal(size=512)
    other -= other @ BASE_VEC / (BASE_VEC @ BASE_VEC) * BASE_VEC
    other /= np.linalg.norm(other)
    unit = BASE_VEC / np.linalg.norm(BASE_VEC)
    c = 0.36
    sc.spec[5]["vec"] = (c * unit + np.sqrt(1 - c * c) * other) * np.linalg.norm(BASE_VEC)
    assert run(sc, "HEAD_MOTION")[1] is None


def test_planar_residual_is_logged_when_landmarks_exist(run, monkeypatch):
    sc = motion_scenario()
    orig = FakeLandmarker.analyse
    face = np.array([[-0.5, 0], [-0.2, 0], [0.2, 0], [0.5, 0], [0, 0.45], [-0.3, 0.9], [0.3, 0.9], [0, 1.5], [-0.8, 0.5], [0.8, 0.5]]) * 300 + 200

    def with_pts(self, img):
        info = orig(self, img)
        info["planar_pts"] = face + np.random.default_rng(int(img[0, 0, 0])).normal(0, 1.5, face.shape)
        return info
    monkeypatch.setattr(FakeLandmarker, "analyse", with_pts)
    _, outcome, trace = run(sc, "HEAD_MOTION")
    assert outcome is None and 0 <= trace["planar_residual"] < 0.1


def test_missing_landmarks_do_not_break_the_pipeline(run):
    _, outcome, trace = run(motion_scenario(), "HEAD_MOTION")
    assert outcome is None and trace["planar_residual"] is None
