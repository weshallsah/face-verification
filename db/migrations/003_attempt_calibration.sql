-- Calibration columns for face_verification_attempts. Metadata only, no images.
-- frames_used and quality_score already exist from 001_init.sql; IF NOT EXISTS keeps this idempotent.
ALTER TABLE face_verification_attempts
    ADD COLUMN IF NOT EXISTS challenge              TEXT,
    ADD COLUMN IF NOT EXISTS challenge_metric       REAL,      -- blink delta or |yaw delta| (degrees) vs the neutral baseline
    ADD COLUMN IF NOT EXISTS challenge_direction_ok BOOLEAN,   -- turn challenges only
    ADD COLUMN IF NOT EXISTS peak_yaw_signed        REAL,      -- yaw - baseline_yaw at the peak frame, signed (MediaPipe convention)
    ADD COLUMN IF NOT EXISTS frames_used            SMALLINT,  -- frames received and decoded
    ADD COLUMN IF NOT EXISTS quality_score          REAL,      -- median Laplacian variance of NEUTRAL/RETURN face crops
    ADD COLUMN IF NOT EXISTS failed_gate            TEXT,      -- the gate/reason that ended the attempt; NULL on ACCEPTED/DUPLICATE/REVIEW/ALREADY_VERIFIED
    ADD COLUMN IF NOT EXISTS client_challenge_ms    INTEGER,   -- prompt shown -> peak frame, from client timestamps (untrusted, logging only)
    ADD COLUMN IF NOT EXISTS restarts               SMALLINT;  -- challenge restarts reported by the client
