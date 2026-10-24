import asyncio
import logging
import time
from collections import Counter, namedtuple
from statistics import median

import cv2
import numpy as np

from . import analysis as A
from . import challenge as C
from .db import dedup_and_insert, log_attempt

log = logging.getLogger(__name__)

# data: JPEG bytes; phase: "NEUTRAL" | "CHALLENGE" | "RETURN"; ts: client ms (logging only)
Frame = namedtuple("Frame", "data phase ts")

PHASES = ("NEUTRAL", "CHALLENGE", "RETURN")
STABLE = ("NEUTRAL", "RETURN")      # frames held to the full quality gates and used for the embedding
QUALITY_ORDER = ("too_dark", "too_bright", "too_blurry", "not_neutral")   # tie-break for the reported reason


class Outcome(Exception):
    """Ends the pipeline early with a final verdict."""
    def __init__(self, verdict, reason, live=0.0):
        self.verdict, self.reason, self.live = verdict, reason, live


def _decode(frames, cfg):
    if not (cfg.min_frames <= len(frames) <= cfg.max_frames):
        raise Outcome("RETRY", "bad_frame_count")
    counts = Counter(f.phase for f in frames)
    if set(counts) - set(PHASES) or counts["NEUTRAL"] < 2 or counts["CHALLENGE"] < 1 or counts["RETURN"] < 1:
        raise Outcome("RETRY", "bad_frame_count")
    imgs = []
    for f in frames:
        img = cv2.imdecode(np.frombuffer(f.data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise Outcome("RETRY", "bad_image")
        imgs.append(img)
    return imgs


def _inspect_stable(models, landmarker, cfg, img):
    """NEUTRAL / RETURN frame: exactly one face, big enough, with quality and occlusion measured."""
    bboxes, kpss = models.detector.detect(img, max_num=0)
    if len(bboxes) == 0:
        raise Outcome("RETRY", "no_face")
    if len(bboxes) > 1:
        raise Outcome("RETRY", "multiple_faces")
    box, kps = bboxes[0], kpss[0]
    if min(box[2] - box[0], box[3] - box[1]) < cfg.min_face_px:
        raise Outcome("RETRY", "face_too_small")
    info = landmarker.analyse(img)
    if info is None:
        raise Outcome("RETRY", "no_face")
    info["nose_dx"] = A.nose_offset(kps)
    info["box"] = box
    info["aligned"] = A.align(img, kps)
    info["quality"] = A.image_quality(info["aligned"])
    info["occlusion"], _ = A.occlusion_class(models, info["aligned"])
    return info


def _inspect_challenge(models, landmarker, img):
    """CHALLENGE frame: only needs a face. No size, quality or occlusion gates (closed eyes read as
    sunglasses, turned heads are small). Returns None when no face could be found."""
    bboxes, kpss = models.detector.detect(img, max_num=0)
    if len(bboxes) == 0:
        return None
    k = max(range(len(bboxes)), key=lambda i: (bboxes[i][2] - bboxes[i][0]) * (bboxes[i][3] - bboxes[i][1]))
    info = landmarker.analyse(img)
    if info is None:
        return None
    info["nose_dx"] = A.nose_offset(kpss[k])
    info["box"] = bboxes[k]
    info["aligned"] = A.align(img, kpss[k])
    return info


def _quality_reason(info, cfg):
    lo, hi = cfg.brightness_range
    q = info["quality"]
    if q["brightness"] < lo:
        return "too_dark"
    if q["brightness"] > hi:
        return "too_bright"
    if q["blur"] < cfg.blur_min:
        return "too_blurry"
    if not A.is_neutral(info, cfg):
        return "not_neutral"
    return None


def _planar_residual(neutral_infos, chal_infos):
    """Median homography residual of the CHALLENGE frames against the neutral landmarks (log only)."""
    try:
        base = [i["planar_pts"] for i in neutral_infos if i.get("planar_pts") is not None]
        if not base:
            return None
        src = np.median(np.stack(base), axis=0)
        vals = [A.planar_residual(src, i["planar_pts"]) for i in chal_infos if i.get("planar_pts") is not None]
        vals = [v for v in vals if v is not None]
        return float(median(vals)) if vals else None
    except Exception:
        log.exception("planar residual failed")
        return None


def _normalise(feats):
    return feats / np.linalg.norm(feats, axis=1, keepdims=True)


def _challenge_failed(reason, live, cfg):
    return Outcome("REJECTED_SPOOF" if cfg.challenge_fail_is_spoof else "RETRY", reason, live)


def analyse_frames(models, landmarker, cfg, challenge, frames, trace, prompt_ts_ms=None):
    """Sync, CPU/GPU-heavy. Returns (embedding, liveness) or raises Outcome.

    `trace` is filled in as we go so the attempt can be logged even when we bail out early.
    """
    imgs = _decode(frames, cfg)
    trace["frames_used"] = len(frames)

    # Cheap sanity checks on the (untrusted) client timeline before any model runs.
    bad_timing, duration = C.check_timing([(f.phase, f.ts) for f in frames], challenge, cfg)
    trace["motion_duration_ms"] = duration if challenge == "HEAD_MOTION" else None
    if bad_timing:
        raise Outcome("REJECTED_SPOOF", bad_timing)

    # ---- Per-frame analysis, phase-aware --------------------------------------------------
    neutral, ret, chal = [], [], []          # (frame_index, info)
    chal_missing = 0
    live_scores = []
    for k, (f, img) in enumerate(zip(frames, imgs)):
        if f.phase == "CHALLENGE":
            info = _inspect_challenge(models, landmarker, img)
            if info is None:
                chal_missing += 1
                continue
            chal.append((k, info))
            if cfg.liveness_on_challenge_frames:
                live_scores.append(A.liveness_score(models, img, info["box"]))
        else:
            info = _inspect_stable(models, landmarker, cfg, img)
            (neutral if f.phase == "NEUTRAL" else ret).append((k, info))
            live_scores.append(A.liveness_score(models, img, info["box"]))

    stable = neutral + ret
    trace["quality_score"] = float(median(i["quality"]["blur"] for _, i in stable))

    if chal_missing > cfg.challenge_max_missing or not chal:
        raise Outcome("RETRY", "face_lost")

    # ---- 1. Liveness: every analysed frame must look real ----------------------------------
    live = float(min(live_scores))
    if live < cfg.liveness_min:
        raise Outcome("REJECTED_SPOOF", "liveness", live)

    if cfg.dev_mode:
        # Per-frame values for calibrating the challenge and quality gates
        for k, info in sorted(stable + chal, key=lambda t: t[0]):
            log.info(
                "frame %d %s %s: yaw=%.1f pitch=%.1f nose_dx=%+.2f blink=%.2f blur=%s bright=%s",
                k, frames[k].phase, challenge, info["yaw"], info["pitch"], info["nose_dx"], C.blink_score(info),
                "%.0f" % info["quality"]["blur"] if "quality" in info else "-",
                "%.0f" % info["quality"]["brightness"] if "quality" in info else "-",
            )

    # ---- 2. Occlusion on NEUTRAL / RETURN only: report the most common problem -------------
    occl = [i["occlusion"] for _, i in stable if i["occlusion"] != "clear"]
    if occl:
        raise Outcome("RETRY", max(set(occl), key=occl.count), live)   # "sunglasses", "mask", ...

    # ---- 2b. Planar (flat photo) residual: LOG ONLY, never enforced yet -------------------
    trace["planar_residual"] = _planar_residual([i for _, i in neutral], [i for _, i in chal])

    # ---- 3. Active challenge, relative to the NEUTRAL baseline -----------------------------
    base_blink, base_yaw = C.baseline([i for _, i in neutral])
    res = None
    if challenge == "HEAD_MOTION":
        base_yaw, base_pitch = C.baseline_pose([i for _, i in neutral])
        motion = C.check_motion(base_yaw, base_pitch, [(i["yaw"], i["pitch"]) for _, i in chal], cfg)
        trace["motion_bins_reached"] = motion.bins_reached
        trace["motion_max_dyaw"] = motion.max_dyaw
        trace["motion_max_dpitch"] = motion.max_dpitch
        if not motion.ok:
            raise _challenge_failed(motion.reason, live, cfg)
    elif challenge == "BLINK":
        res = C.check_blink(
            base_blink,
            [C.blink_score(i) for _, i in chal],
            [C.blink_score(i) for _, i in ret],
            cfg,
        )
    elif challenge in ("TURN_LEFT", "TURN_RIGHT"):
        res = C.check_turn(challenge, base_yaw, [(i["yaw"], i["nose_dx"]) for _, i in chal], cfg)
    else:
        raise Outcome("RETRY", "bad_frame_count", live)

    if res is not None:        # BLINK / TURN_*
        trace["challenge_metric"] = res.metric
        trace["challenge_direction_ok"] = res.direction_ok
        trace["peak_yaw_signed"] = res.peak_yaw_signed
        if res.peak_idx is not None and prompt_ts_ms is not None:
            peak_ts = frames[chal[res.peak_idx][0]].ts
            trace["client_challenge_ms"] = max(0, int(peak_ts) - int(prompt_ts_ms))
        if not res.ok:
            raise _challenge_failed(res.reason, live, cfg)

    # ---- 4. Clean neutral frames for the embedding (challenge frames are never used) -------
    reasons = {k: _quality_reason(i, cfg) for k, i in stable}
    good = [(k, i) for k, i in stable if reasons[k] is None]
    if len(good) < cfg.min_neutral_frames:
        failing = Counter(r for r in reasons.values() if r)
        worst = max(failing, key=lambda r: (failing[r], -QUALITY_ORDER.index(r)))
        raise Outcome("RETRY", worst, live)

    # ---- 5. Embeddings --------------------------------------------------------------------
    feats = _normalise(np.stack([models.recognizer.get_feat(i["aligned"]).flatten() for _, i in stable]))
    if (feats @ feats.T).min() < cfg.same_person_min_sim:
        raise Outcome("REJECTED_SPOOF", "face_changed_during_session", live)

    pos = {k: n for n, (k, _) in enumerate(stable)}
    emb = feats[[pos[k] for k, _ in good]].mean(axis=0)
    emb = emb / np.linalg.norm(emb)

    chal_feats = _normalise(np.stack([models.recognizer.get_feat(i["aligned"]).flatten() for _, i in chal]))
    min_sim = cfg.same_person_motion_min if challenge == "HEAD_MOTION" else cfg.same_person_challenge_min
    if (chal_feats @ emb).min() < min_sim:
        raise Outcome("REJECTED_SPOOF", "face_changed_during_session", live)

    return emb.astype(np.float32), live


async def enroll(models, landmarker, pool, cfg, user_id, session_id, challenge, frames,
                 prompt_ts_ms=None, restarts=0):
    t0 = time.perf_counter()
    verdict, reason, top_sim, live = "RETRY", "", 0.0, 0.0
    trace = {"challenge": challenge, "restarts": max(0, min(int(restarts), 10)), "failed_gate": None}
    try:
        emb, live = await asyncio.to_thread(
            analyse_frames, models, landmarker, cfg, challenge, frames, trace, prompt_ts_ms
        )
        verdict, top_sim = await dedup_and_insert(pool, cfg, int(user_id), emb, live)
        reason = "" if verdict == "ACCEPTED" else verdict.lower()
    except Outcome as o:
        verdict, reason, live = o.verdict, o.reason, o.live
        trace["failed_gate"] = o.reason
    except Exception:
        trace["failed_gate"] = "internal_error"
        raise
    finally:
        try:
            await log_attempt(
                pool, user_id, session_id, verdict, reason, top_sim, live,
                int((time.perf_counter() - t0) * 1000), trace,
            )
        except Exception:
            # e.g. migration 003 not applied yet: never lose the verdict because logging failed
            log.exception("could not log verification attempt")
    return verdict, reason, top_sim, live
