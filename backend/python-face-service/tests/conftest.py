import os
import sys
from unittest.mock import MagicMock

os.environ.setdefault("DATABASE_URL", "host=localhost dbname=test")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# The heavy ML / DB packages are not needed to test decision logic; stub whatever is not installed.
for name in (
    "mediapipe", "mediapipe.tasks", "mediapipe.tasks.python", "mediapipe.tasks.python.vision",
    "insightface", "insightface.utils", "insightface.utils.face_align",
    "psycopg_pool", "pgvector", "pgvector.psycopg",
):
    try:
        __import__(name)
    except ImportError:
        sys.modules[name] = MagicMock()
