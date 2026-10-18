import os
from dataclasses import dataclass


def _flag(name, default="false"):
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


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
    max_frames: int = 8
    min_face_px: int = 120                 # shortest side of the face box

    # Gates — STARTING POINTS, calibrate with tools/evaluate.py
    liveness_min: float = 0.90             # per-frame real probability
    blur_min: float = 60.0                 # Laplacian variance on the face crop
    brightness_range: tuple = (60, 200)    # mean grey level on the face crop
    neutral_max_blendshape: float = 0.35   # jawOpen, mouthSmile*, eyeSquint*, cheekPuff ...
    neutral_max_yaw_deg: float = 15.0
    neutral_max_pitch_deg: float = 15.0
    min_neutral_frames: int = 2
    same_person_min_sim: float = 0.55      # all frames in a session must agree

    # Dedup (cosine similarity) — STARTING POINTS, must be calibrated
    dup_high: float = 0.60                 # >= : duplicate
    dup_low: float = 0.45                  # [low, high) : human review
    hnsw_ef_search: int = 100

    def __post_init__(self):
        if self.dev_mode and self.app_env.lower() == "production":
            raise SystemExit("Refusing to start: DEV_MODE=true with APP_ENV=production.")


CFG = Config()
