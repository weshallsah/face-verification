import os
from dataclasses import dataclass


def _flag(name, default="false"):
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


def _float(name, default):
    return float(os.getenv(name, default))


def _int(name, default):
    return int(os.getenv(name, default))


@dataclass(frozen=True)
class Config:
    database_url: str = os.environ["DATABASE_URL"]
    grpc_port: int = int(os.getenv("GRPC_PORT", "50051"))

    # DEV_MODE skips the liveness and occlusion models and returns "real"/"clear".
    # Photos and phone screens will pass. Never enable in production.
    dev_mode: bool = _flag("DEV_MODE")
    app_env: str = os.getenv("APP_ENV", "production")

    # Defaults match the buffalo_l pack file names.
    detector_path: str = os.getenv("DETECTOR_PATH", "models/det_10g.onnx")
    recognizer_path: str = os.getenv("RECOGNIZER_PATH", "models/w600k_r50.onnx")
    liveness_path: str = os.getenv("LIVENESS_PATH", "models/liveness.onnx")
    occlusion_path: str = os.getenv("OCCLUSION_PATH", "models/occlusion.onnx")
    landmarker_path: str = os.getenv("LANDMARKER_PATH", "models/face_landmarker.task")
    model_version: str = os.getenv("MODEL_VERSION", "arcface-r50-w600k-v1")

    # Frame limits
    min_frames: int = 5
    max_frames: int = 13                   # 3 NEUTRAL + up to 8 CHALLENGE + 2 RETURN
    # Shortest side of the face box. Frames arrive downscaled to 640px on the long side,
    # so the browser requires ~140px before it starts capturing (see MIN_FACE_PX in index.html).
    min_face_px: int = 120

    # Gates — STARTING POINTS, calibrate with tools/evaluate.py
    liveness_min: float = 0.90             # per-frame real probability
    blur_min: float = 60.0                 # Laplacian variance on the face crop
    brightness_range: tuple = (60, 200)    # mean grey level on the face crop
    neutral_max_blendshape: float = 0.35   # jawOpen, mouthSmile*, eyeSquint*, cheekPuff ...
    neutral_max_yaw_deg: float = 15.0
    neutral_max_pitch_deg: float = 15.0
    min_neutral_frames: int = 2
    same_person_min_sim: float = 0.55      # NEUTRAL + RETURN frames must all agree pairwise

    # Challenge checks, relative to the user's own NEUTRAL baseline (median of NEUTRAL frames).
    # STARTING POINTS: calibrate from face_verification_attempts.challenge_metric.
    blink_delta: float = _float("BLINK_DELTA", 0.25)                  # peak blink score must exceed baseline by this
    blink_return_margin: float = _float("BLINK_RETURN_MARGIN", 0.15)  # RETURN eyes must be below baseline + this
    turn_delta_deg: float = _float("TURN_DELTA_DEG", 12.0)            # peak |yaw - baseline yaw|
    # CHALLENGE frames vs the NEUTRAL mean embedding. Loose on purpose: closed eyes and turned heads
    # lower similarity. Only a different person should fall below it.
    same_person_challenge_min: float = _float("SAME_PERSON_CHALLENGE_MIN", 0.38)
    challenge_max_missing: int = _int("CHALLENGE_MAX_MISSING", 1)     # CHALLENGE frames allowed with no face
    # HEAD_MOTION: any-direction, any-shape head movement. Starting values, calibrate from the logged
    # motion_bins_reached / motion_max_dyaw / motion_max_dpitch.
    motion_yaw_deg: float = _float("MOTION_YAW_DEG", 10.0)     # yaw delta that counts as "reached" (m = 1)
    motion_pitch_deg: float = _float("MOTION_PITCH_DEG", 7.0)  # pitch delta that counts as "reached" (m = 1)
    motion_bins: int = _int("MOTION_BINS", 8)                  # sectors around the baseline
    motion_min_bins: int = _int("MOTION_MIN_BINS", 5)          # sectors that must be reached
    motion_min_duration_ms: int = _int("MOTION_MIN_DURATION_MS", 800)   # first to last CHALLENGE frame
    # CHALLENGE frames vs the NEUTRAL mean embedding. Lower than the blink/turn value: angled faces score lower.
    same_person_motion_min: float = _float("SAME_PERSON_MOTION_MIN", 0.35)
    # False: a missed blink/turn/motion is a RETRY (user error, 10/h limit). True: it is REJECTED_SPOOF (3/h limit).
    challenge_fail_is_spoof: bool = _flag("CHALLENGE_FAIL_IS_SPOOF")
    # Passive liveness on turned / eyes-closed frames may be less reliable than on frontal ones.
    # Set false to run it on NEUTRAL + RETURN frames only. Re-check once a real liveness model is installed.
    liveness_on_challenge_frames: bool = _flag("LIVENESS_ON_CHALLENGE_FRAMES", "true")

    # Dedup (cosine similarity) — STARTING POINTS, must be calibrated
    dup_high: float = 0.60                 # >= : duplicate
    dup_low: float = 0.45                  # [low, high) : human review
    hnsw_ef_search: int = 100

    def __post_init__(self):
        if self.dev_mode and self.app_env.lower() == "production":
            raise SystemExit("Refusing to start: DEV_MODE=true with APP_ENV=production.")


CFG = Config()
