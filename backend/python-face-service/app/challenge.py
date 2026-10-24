"""Challenge decisions, relative to the user's own NEUTRAL baseline.

Pure functions over per-frame numbers (no models), so they are cheap to unit test.
"""
import math
from dataclasses import dataclass
from statistics import median
from typing import Optional


@dataclass
class ChallengeResult:
    ok: bool
    reason: str = ""                       # reason code when not ok
    metric: Optional[float] = None         # blink delta, or |yaw delta| in degrees
    direction_ok: Optional[bool] = None    # turn challenges only
    peak_yaw_signed: Optional[float] = None  # yaw - baseline_yaw at the peak frame
    peak_idx: Optional[int] = None         # index into the CHALLENGE frames given


def blink_score(frame_info):
    s = frame_info["blendshapes"]
    return (s.get("eyeBlinkLeft", 0) + s.get("eyeBlinkRight", 0)) / 2


def baseline(infos):
    """Median blink score and yaw of the NEUTRAL frames."""
    return median(blink_score(i) for i in infos), median(i["yaw"] for i in infos)


def check_blink(base_blink, challenge_scores, return_scores, cfg):
    peak_idx = max(range(len(challenge_scores)), key=challenge_scores.__getitem__)
    delta = challenge_scores[peak_idx] - base_blink
    if delta < cfg.blink_delta:
        return ChallengeResult(False, "blink_not_detected", delta, peak_idx=peak_idx)
    # Eyes must be open again. Lower median, so with 2 frames one caught mid-blink is tolerated.
    reopened = sorted(return_scores)[(len(return_scores) - 1) // 2]
    if reopened >= base_blink + cfg.blink_return_margin:
        return ChallengeResult(False, "eyes_not_reopened", delta, peak_idx=peak_idx)
    return ChallengeResult(True, "", delta, peak_idx=peak_idx)


def check_turn(challenge, base_yaw, frames, cfg):
    """frames: [(yaw, nose_dx), ...] for CHALLENGE frames with a face.

    Magnitude comes from the MediaPipe yaw relative to the baseline. Direction comes from
    nose_dx (2D geometry on the un-mirrored frame: > 0 is the subject's left), so it does not
    depend on the pose matrix sign convention. peak_yaw_signed is logged so the yaw sign can be
    validated against nose_dx before anyone relies on it.
    """
    direction = 1 if challenge == "TURN_LEFT" else -1
    deltas = [yaw - base_yaw for yaw, _ in frames]
    peak_idx = max(range(len(deltas)), key=lambda i: abs(deltas[i]))
    magnitude = abs(deltas[peak_idx])
    direction_ok = frames[peak_idx][1] * direction > 0
    common = dict(metric=magnitude, direction_ok=direction_ok,
                  peak_yaw_signed=deltas[peak_idx], peak_idx=peak_idx)
    if magnitude < cfg.turn_delta_deg:
        return ChallengeResult(False, "turn_too_small", **common)
    if not direction_ok:
        return ChallengeResult(False, "wrong_direction", **common)
    return ChallengeResult(True, "", **common)


def baseline_pose(infos):
    """Median yaw and pitch of the NEUTRAL frames."""
    return median(i["yaw"] for i in infos), median(i["pitch"] for i in infos)


@dataclass
class MotionResult:
    ok: bool
    reason: str = ""
    bins_reached: int = 0
    max_dyaw: float = 0.0       # largest |yaw - baseline| over the frames, degrees
    max_dpitch: float = 0.0


def check_motion(base_yaw, base_pitch, poses, cfg):
    """HEAD_MOTION: lenient. poses: [(yaw, pitch), ...] for CHALLENGE frames with a face.

    Each frame's offset from the baseline is scaled to (nx, ny) so that |(nx, ny)| >= 1 means the head
    left the "centre". Its angle puts it in one of `motion_bins` sectors. Any shape, direction, order and
    speed passes as long as `motion_min_bins` different sectors are reached. Angle signs and axis
    conventions do not matter (a reflection or rotation by whole sectors maps bins onto bins).
    """
    reached, max_dyaw, max_dpitch = set(), 0.0, 0.0
    for yaw, pitch in poses:
        dyaw, dpitch = yaw - base_yaw, pitch - base_pitch
        max_dyaw, max_dpitch = max(max_dyaw, abs(dyaw)), max(max_dpitch, abs(dpitch))
        nx, ny = dyaw / cfg.motion_yaw_deg, dpitch / cfg.motion_pitch_deg
        if math.hypot(nx, ny) >= 1.0:
            angle = math.atan2(ny, nx) % (2 * math.pi)
            reached.add(int(angle // (2 * math.pi / cfg.motion_bins)) % cfg.motion_bins)
    ok = len(reached) >= cfg.motion_min_bins
    return MotionResult(ok, "" if ok else "motion_insufficient", len(reached), max_dyaw, max_dpitch)


def check_timing(timeline, challenge, cfg):
    """timeline: [(phase, client_ts_ms), ...] in upload order. Returns (reason or None, motion_duration_ms).

    The browser timestamps are not trusted for anything else, but a real head cannot do a lap in no time
    and a replayed / scripted upload tends to have sloppy ordering.
    """
    last, chal = {}, []
    for phase, ts in timeline:
        if phase in last and ts <= last[phase]:
            return "bad_timestamps", None
        last[phase] = ts
        if phase == "CHALLENGE":
            chal.append(ts)
    duration = (chal[-1] - chal[0]) if chal else None
    if challenge == "HEAD_MOTION" and (duration is None or duration < cfg.motion_min_duration_ms):
        return "motion_too_fast", duration
    return None, duration
