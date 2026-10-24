import logging
import os

import onnxruntime as ort
from insightface.model_zoo import get_model

log = logging.getLogger(__name__)

PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]


def _check_files(cfg):
    required = {
        "DETECTOR_PATH": cfg.detector_path,
        "RECOGNIZER_PATH": cfg.recognizer_path,
        "LANDMARKER_PATH": cfg.landmarker_path,
    }
    if not cfg.dev_mode:
        required["LIVENESS_PATH"] = cfg.liveness_path
        required["OCCLUSION_PATH"] = cfg.occlusion_path
    missing = [f"  {k}: {p}" for k, p in required.items() if not os.path.exists(p)]
    if missing:
        raise SystemExit("Missing model files:\n" + "\n".join(missing))


class FaceModels:
    """Loaded once at startup. Never load models per request."""

    def __init__(self, cfg):
        logging.basicConfig(level=logging.INFO)
        _check_files(cfg)

        self.detector = get_model(cfg.detector_path, providers=PROVIDERS)
        self.detector.prepare(ctx_id=0, input_size=(640, 640), det_thresh=0.5)

        self.recognizer = get_model(cfg.recognizer_path, providers=PROVIDERS)
        self.recognizer.prepare(ctx_id=0)

        if cfg.dev_mode:
            log.warning("DEV_MODE is ON: liveness and occlusion checks are stubbed. "
                        "Photos and screens will pass. Do not use with real user data.")
            self.liveness = None
            self.occlusion = None
        else:
            self.liveness = ort.InferenceSession(cfg.liveness_path, providers=PROVIDERS)
            self.occlusion = ort.InferenceSession(cfg.occlusion_path, providers=PROVIDERS)

        log.info("ONNX Runtime providers available: %s", ort.get_available_providers())
