-- HEAD_MOTION calibration columns. Metadata only, no images. Idempotent: several of these
-- (challenge, frames_used, quality_score, failed_gate, restarts) already exist from 001 / 003.
ALTER TABLE face_verification_attempts
    ADD COLUMN IF NOT EXISTS challenge            TEXT,
    ADD COLUMN IF NOT EXISTS motion_bins_reached  SMALLINT,  -- sectors reached (of motion_bins) by the server's own yaw/pitch
    ADD COLUMN IF NOT EXISTS motion_max_dyaw      REAL,      -- largest |yaw - baseline| over CHALLENGE frames, degrees
    ADD COLUMN IF NOT EXISTS motion_max_dpitch    REAL,      -- largest |pitch - baseline|, degrees
    ADD COLUMN IF NOT EXISTS motion_duration_ms   INTEGER,   -- first to last CHALLENGE frame, client timestamps
    ADD COLUMN IF NOT EXISTS planar_residual      REAL,      -- median homography residual / inter-eye distance. LOG ONLY, not enforced
    ADD COLUMN IF NOT EXISTS frames_used          SMALLINT,
    ADD COLUMN IF NOT EXISTS quality_score        REAL,
    ADD COLUMN IF NOT EXISTS failed_gate          TEXT,
    ADD COLUMN IF NOT EXISTS restarts             SMALLINT;
