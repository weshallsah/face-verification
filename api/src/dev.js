import { Router } from 'express';
import pg from 'pg';

// Dev-only read access to the face tables. Embedding vectors are never returned.
// Connection comes from the standard PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env vars.
const pool = new pg.Pool({ max: 2 });

const router = Router();

router.get('/db', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const [embeddings, review, attempts, counts] = await Promise.all([
      pool.query(
        `SELECT user_id, model_version, liveness_score, quality_score, created_at, updated_at
         FROM face_embeddings ORDER BY updated_at DESC LIMIT $1`, [limit]),
      pool.query(
        `SELECT id, user_id, matched_user_id, similarity, model_version, status, created_at, decided_at
         FROM face_review_queue ORDER BY created_at DESC LIMIT $1`, [limit]),
      pool.query(
        `SELECT id, user_id, session_id, verdict, reason_code, top_similarity, liveness_score, latency_ms, created_at
         FROM face_verification_attempts ORDER BY created_at DESC LIMIT $1`, [limit]),
      pool.query(
        `SELECT (SELECT count(*) FROM face_embeddings)::int AS embeddings,
                (SELECT count(*) FROM face_review_queue)::int AS review_queue,
                (SELECT count(*) FROM face_verification_attempts)::int AS attempts`),
    ]);
    res.json({
      counts: counts.rows[0],
      face_embeddings: embeddings.rows,
      face_review_queue: review.rows,
      face_verification_attempts: attempts.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
