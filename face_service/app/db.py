from pgvector.psycopg import register_vector_async
from psycopg_pool import AsyncConnectionPool

ENROLL_LOCK_ID = 727001   # any constant bigint


async def make_pool(dsn):
    pool = AsyncConnectionPool(dsn, min_size=2, max_size=10, open=False,
                               configure=register_vector_async)
    await pool.open()
    return pool


async def dedup_and_insert(pool, cfg, user_id, emb, liveness):
    async with pool.connection() as conn:
        async with conn.transaction():
            # Serialises enrollments so two simultaneous signups by the same
            # person can't both pass. Fine at signup volumes; shard the lock
            # (or use a queue) if enrollment traffic grows very large.
            await conn.execute("SELECT pg_advisory_xact_lock(%s)", (ENROLL_LOCK_ID,))
            await conn.execute(f"SET LOCAL hnsw.ef_search = {int(cfg.hnsw_ef_search)}")

            # A user who is already verified cannot enroll again (no silent overwrite).
            cur = await conn.execute(
                "SELECT 1 FROM face_embeddings WHERE user_id = %s", (user_id,)
            )
            if await cur.fetchone():
                return "ALREADY_VERIFIED", 0.0

            cur = await conn.execute(
                """
                SELECT user_id, 1 - (embedding <=> %s) AS sim
                FROM face_embeddings
                WHERE model_version = %s AND user_id <> %s
                ORDER BY embedding <=> %s
                LIMIT 1
                """,
                (emb, cfg.model_version, user_id, emb),
            )
            row = await cur.fetchone()
            top_sim = float(row[1]) if row else 0.0

            if row and top_sim >= cfg.dup_high:
                return "DUPLICATE", top_sim

            if row and top_sim >= cfg.dup_low:
                await conn.execute(
                    """INSERT INTO face_review_queue
                       (user_id, matched_user_id, similarity, embedding, model_version)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (user_id, row[0], top_sim, emb, cfg.model_version),
                )
                return "REVIEW", top_sim

            await conn.execute(
                """INSERT INTO face_embeddings (user_id, embedding, model_version, liveness_score)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (user_id) DO UPDATE
                   SET embedding = EXCLUDED.embedding,
                       model_version = EXCLUDED.model_version,
                       liveness_score = EXCLUDED.liveness_score,
                       updated_at = now()""",
                (user_id, emb, cfg.model_version, liveness),
            )
            return "ACCEPTED", top_sim


async def log_attempt(pool, user_id, session_id, verdict, reason, top_sim, live, latency_ms):
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO face_verification_attempts
               (user_id, session_id, verdict, reason_code, top_similarity, liveness_score, latency_ms)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (int(user_id), session_id, verdict, reason, top_sim, live, latency_ms),
        )
