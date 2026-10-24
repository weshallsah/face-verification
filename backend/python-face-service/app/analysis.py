import math
import threading

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from insightface.utils import face_align

from .challenge import blink_score  # noqa: F401  (re-exported for callers of analysis)

# Mouth only. Brow, squint and blink scores vary too much between people at rest to gate on.
NON_NEUTRAL_KEYS = (
    "jawOpen", "mouthSmileLeft", "mouthSmileRight", "mouthPucker", "mouthFunnel",
)
# MediaPipe mesh indices: eye corners (33, 133, 362, 263), nose tip, mouth corners, chin, jaw sides.
PLANAR_IDX = (33, 133, 362, 263, 1, 61, 291, 152, 234, 454)
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
        h, w = bgr.shape[:2]
        pts = np.array([[res.face_landmarks[0][i].x * w, res.face_landmarks[0][i].y * h] for i in PLANAR_IDX])
        return {"blendshapes": shapes, "yaw": yaw, "pitch": pitch, "planar_pts": pts}


def _yaw_pitch(m):
    r = m[:3, :3]
    yaw = math.degrees(math.atan2(r[0, 2], r[2, 2]))
    # atan2 form: the transformation matrix carries a scale, which would distort asin(-r12).
    # Same as the browser. Signs are arbitrary; the checks only use magnitudes and differences.
    pitch = math.degrees(math.atan2(-r[1, 2], math.hypot(r[0, 2], r[2, 2])))
    return yaw, pitch


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


def nose_offset(kps):
    """Nose x relative to the eye midpoint, in inter-eye distances, from detector keypoints.

    Frames are un-mirrored camera images, so the subject's left is image right:
    > 0 means the head is turned to the subject's left, < 0 to their right.
    """
    eyes_mid = (kps[0][0] + kps[1][0]) / 2
    return float((kps[2][0] - eyes_mid) / max(abs(kps[1][0] - kps[0][0]), 1.0))


def planar_residual(neutral_pts, frame_pts):
    """LOG ONLY. How well one homography maps the neutral landmarks onto this frame's, as a mean
    reprojection error in inter-eye distances. A flat photo (even tilted) is explained by a homography,
    a rotating 3D face is not, so a real head should leave a clearly larger residual. No threshold yet."""
    src = np.asarray(neutral_pts, dtype=np.float64)
    dst = np.asarray(frame_pts, dtype=np.float64)
    H, _ = cv2.findHomography(src, dst, 0)
    if H is None:
        return None
    proj = cv2.perspectiveTransform(src[None], H)[0]
    ipd = np.linalg.norm(dst[0] - dst[3])           # outer eye corners (33, 263)
    return float(np.linalg.norm(proj - dst, axis=1).mean() / max(ipd, 1e-6))
