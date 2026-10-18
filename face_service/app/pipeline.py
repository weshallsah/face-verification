import asyncio
import time

import cv2
import numpy as np

from . import analysis as A
from .db import dedup_and_insert, log_attempt


class Outcome(Exception):
    """Ends the pipeline early with a final verdict."""
    def __init__(self, verdict, reason, live=0.0):
        self.verdict, self.reason, self.live = verdict, reason, live


def _decode(frames, cfg):
    if not (cfg.min_frames <= len(frames) <= cfg.max_frames):
        raise Outcome("RETRY", "bad_frame_count")
    imgs = []
    for b in frames:
        img = cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise Outcome("RETRY", "bad_image")
        imgs.append(img)
    return imgs


def analyse_frames(models, landmarker, cfg, challenge, frames):
    """Sync, CPU/GPU-heavy. Returns (embedding, liveness) or raises Outcome."""
    imgs = _decode(frames, cfg)

    infos, aligned, live_scores = [], [], []
    for img in imgs:
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

        crop = A.align(img, kps)
        info["quality"] = A.image_quality(crop)
        info["occlusion"], _ = A.occlusion_class(models, crop)

        infos.append(info)
        aligned.append(crop)
        live_scores.append(A.liveness_score(models, img, box))

    # 1. Liveness: every frame must look real
    live = float(min(live_scores))
    if live < cfg.liveness_min:
        raise Outcome("REJECTED_SPOOF", "liveness", live)

    # 2. Active challenge
    if not A.challenge_passed(challenge, infos):
        raise Outcome("REJECTED_SPOOF", "challenge", live)

    # 3. Occlusion: report the most common problem so the app can show a specific hint
    occl = [i["occlusion"] for i in infos if i["occlusion"] != "clear"]
    if occl:
        raise Outcome("RETRY", max(set(occl), key=occl.count), live)   # "sunglasses", "mask", ...

    # 4. Clean neutral frames for the embedding (challenge frames are only for liveness)
    lo, hi = cfg.brightness_range
    idx = [
        k for k, i in enumerate(infos)
        if A.is_neutral(i, cfg)
        and i["quality"]["blur"] >= cfg.blur_min
        and lo <= i["quality"]["brightness"] <= hi
    ]
    if len(idx) < cfg.min_neutral_frames:
        raise Outcome("RETRY", "not_neutral_or_low_quality", live)

    # 5. Embeddings for ALL frames, batched — also used for the same-person check
    feats = np.stack([models.recognizer.get_feat(c).flatten() for c in aligned])
    feats = feats / np.linalg.norm(feats, axis=1, keepdims=True)
    if (feats @ feats.T).min() < cfg.same_person_min_sim:
        raise Outcome("REJECTED_SPOOF", "face_changed_during_session", live)

    emb = feats[idx].mean(axis=0)
    emb = emb / np.linalg.norm(emb)
    return emb.astype(np.float32), live


async def enroll(models, landmarker, pool, cfg, user_id, session_id, challenge, frames):
    t0 = time.perf_counter()
    verdict, reason, top_sim, live = "RETRY", "", 0.0, 0.0
    try:
        emb, live = await asyncio.to_thread(
            analyse_frames, models, landmarker, cfg, challenge, frames
        )
        verdict, top_sim = await dedup_and_insert(pool, cfg, int(user_id), emb, live)
        reason = "" if verdict == "ACCEPTED" else verdict.lower()
    except Outcome as o:
        verdict, reason, live = o.verdict, o.reason, o.live
    finally:
        await log_attempt(
            pool, user_id, session_id, verdict, reason, top_sim, live,
            int((time.perf_counter() - t0) * 1000),
        )
    return verdict, reason, top_sim, live
