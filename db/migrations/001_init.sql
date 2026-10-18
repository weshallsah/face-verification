CREATE EXTENSION IF NOT EXISTS vector;

-- One reference embedding per verified user. No images, ever.
CREATE TABLE face_embeddings (
    user_id         BIGINT PRIMARY KEY,
    embedding       vector(512) NOT NULL,      -- L2-normalised
    model_version   TEXT        NOT NULL,      -- e.g. 'arcface-r100-v1'
    liveness_score  REAL,
    quality_score   REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX face_embeddings_hnsw
    ON face_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Borderline matches wait here for a human decision.
CREATE TABLE face_review_queue (
    id               BIGSERIAL PRIMARY KEY,
    user_id          BIGINT      NOT NULL,
    matched_user_id  BIGINT      NOT NULL,
    similarity       REAL        NOT NULL,
    embedding        vector(512) NOT NULL,
    model_version    TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at       TIMESTAMPTZ
);

-- Audit log for every attempt (metadata only). Used for threshold tuning and abuse detection.
CREATE TABLE face_verification_attempts (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT      NOT NULL,
    session_id      UUID        NOT NULL,
    verdict         TEXT        NOT NULL,
    reason_code     TEXT,
    top_similarity  REAL,
    liveness_score  REAL,
    quality_score   REAL,
    frames_used     SMALLINT,
    latency_ms      INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON face_verification_attempts (user_id, created_at DESC);
