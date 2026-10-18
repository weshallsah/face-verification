import math
import threading

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from insightface.utils import face_align

NON_NEUTRAL_KEYS = (
    "jawOpen", "mouthSmileLeft", "mouthSmileRight", "mouthPucker", "mouthFunnel",
    "eyeSquintLeft", "eyeSquintRight", "eyeBlinkLeft", "eyeBlinkRight",
    "cheekPuff", "browDownLeft", "browDownRight", "browInnerUp",
)
OCCLUSION_CLASSES = ("clear", "sunglasses", "mask", "hand", "other")


class Landmarker:
    def __init__(self, path):
        opts = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=path),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=2,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )
        self.lm = vision.FaceLandmarker.create_from_options(opts)
        self._lock = threading.Lock()   # the landmarker is shared across worker threads

    def analyse(self, bgr):
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        with self._lock:
            res = self.lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if not res.face_blendshapes:
            return None
        shapes = {c.category_name: c.score for c in res.face_blendshapes[0]}
        yaw, pitch = _yaw_pitch(np.array(res.facial_transformation_matrixes[0]))
        return {"blendshapes": shapes, "yaw": yaw, "pitch": pitch}


def _yaw_pitch(m):
    r = m[:3, :3]
    yaw = math.degrees(math.atan2(r[0, 2], r[2, 2]))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, -r[1, 2]))))
    return yaw, pitch   # verify sign convention with a quick test: turn left → which sign?


def align(bgr, kps):
    return face_align.norm_crop(bgr, landmark=kps, image_size=112)


def image_quality(crop):
    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return {
        "blur": float(cv2.Laplacian(grey, cv2.CV_64F).var()),
        "brightness": float(grey.mean()),
    }


def _softmax(x):
    e = np.exp(x - x.max())
    return e / e.sum()


def _run_classifier(session, crop, size):
    # IMPORTANT: match the preprocessing your model was trained with
    # (size, RGB/BGR, mean/std). This is a common ImageNet-style default.
    img = cv2.resize(crop, size)[:, :, ::-1].astype(np.float32) / 255.0
    img = (img - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    blob = img.transpose(2, 0, 1)[None].astype(np.float32)
    logits = session.run(None, {session.get_inputs()[0].name: blob})[0][0]
    return _softmax(logits)


def occlusion_class(models, aligned):
    if models.occlusion is None:          # DEV_MODE
        return "clear", 1.0
    probs = _run_classifier(models.occlusion, aligned, (112, 112))
    idx = int(probs.argmax())
    return OCCLUSION_CLASSES[idx], float(probs[idx])


def liveness_score(models, bgr, bbox):
    if models.liveness is None:           # DEV_MODE
        return 1.0
    # Passive liveness models usually expect a wider crop around the face (e.g. 2.7x box).
    x1, y1, x2, y2 = bbox[:4]
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    s = max(x2 - x1, y2 - y1) * 2.7 / 2
    h, w = bgr.shape[:2]
    crop = bgr[max(0, int(cy - s)):min(h, int(cy + s)), max(0, int(cx - s)):min(w, int(cx + s))]
    probs = _run_classifier(models.liveness, crop, (80, 80))
    return float(probs[1])   # assume index 1 = "real"; check your model's label order


def is_neutral(frame_info, cfg):
    s = frame_info["blendshapes"]
    return (
        all(s.get(k, 0.0) < cfg.neutral_max_blendshape for k in NON_NEUTRAL_KEYS)
        and abs(frame_info["yaw"]) < cfg.neutral_max_yaw_deg
        and abs(frame_info["pitch"]) < cfg.neutral_max_pitch_deg
    )


def challenge_passed(challenge, infos):
    """infos: per-frame dicts from Landmarker.analyse, in capture order."""
    if challenge == "BLINK":
        closed = [
            (f["blendshapes"].get("eyeBlinkLeft", 0) + f["blendshapes"].get("eyeBlinkRight", 0)) / 2 > 0.6
            for f in infos
        ]
        # open → closed → open somewhere in the sequence
        return any(closed[1:-1]) and not closed[0] and not closed[-1]

    yaws = [f["yaw"] for f in infos]
    if challenge == "TURN_LEFT":
        return max(yaws) > 20 and abs(yaws[0]) < 12      # flip signs if your convention differs
    if challenge == "TURN_RIGHT":
        return min(yaws) < -20 and abs(yaws[0]) < 12
    return False
