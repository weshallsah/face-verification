import { Router } from 'express';
import pg from 'pg';
import { redis } from './redis.js';

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

// Dev-only deletes, used by the dashboard. face_svc has DELETE but not TRUNCATE.
async function deleteRedisKeys(pattern) {
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    if (keys.length) deleted += await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
  return deleted;
}

router.post('/clear', async (req, res, next) => {
  try {
    const client = await pool.connect();
    let rows;
    try {
      await client.query('BEGIN');
      const r = await client.query('DELETE FROM face_review_queue');
      const a = await client.query('DELETE FROM face_verification_attempts');
      const e = await client.query('DELETE FROM face_embeddings');
      await client.query('COMMIT');
      rows = { embeddings: e.rowCount, review_queue: r.rowCount, attempts: a.rowCount };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const redisKeys = await deleteRedisKeys('face:session:*') + await deleteRedisKeys('rl:face:*');
    res.json({ deleted: { ...rows, redis_keys: redisKeys } });
  } catch (err) {
    next(err);
  }
});

router.post('/rate-limits/clear', async (req, res, next) => {
  try {
    res.json({ deleted: { redis_keys: await deleteRedisKeys('rl:face:*') } });
  } catch (err) {
    next(err);
  }
});

// Removes everything stored for one user, so they can enroll again from scratch.
router.delete('/users/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'id_must_be_numeric' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        'DELETE FROM face_review_queue WHERE user_id = $1 OR matched_user_id = $1', [id]);
      const a = await client.query('DELETE FROM face_verification_attempts WHERE user_id = $1', [id]);
      const e = await client.query('DELETE FROM face_embeddings WHERE user_id = $1', [id]);
      await client.query('COMMIT');
      res.json({ deleted: { embeddings: e.rowCount, review_queue: r.rowCount, attempts: a.rowCount } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

export default router;
