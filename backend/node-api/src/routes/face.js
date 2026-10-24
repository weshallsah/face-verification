import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../redis.js';
import { enroll } from '../grpc.js';
import { requireAuth } from '../auth.js';

const CHALLENGES = ['HEAD_MOTION'];   // BLINK / TURN_* still exist in the proto but are no longer issued
const PHASES = new Set(['NEUTRAL', 'CHALLENGE', 'RETURN']);
// Long enough for the guided flow (neutral wait + up to 3 challenge windows + return).
const SESSION_TTL = Number(process.env.FACE_SESSION_TTL ?? 300);   // seconds
const MIN_FRAMES = 5;
const MAX_FRAMES = 13;   // 3 neutral + up to 8 motion + 2 return
const MAX_RESTARTS = 2;

// Verdict-based limits. RETRY = capture/quality problems, SPOOF = REJECTED_SPOOF verdicts.
const RETRY_LIMIT = Number(process.env.FACE_RETRY_LIMIT ?? 10);
const SPOOF_LIMIT = Number(process.env.FACE_SPOOF_LIMIT ?? 3);
const OUTCOME_WINDOW = Number(process.env.FACE_OUTCOME_WINDOW_SEC ?? 3600);
const GRPC_TIMEOUT_MS = Number(process.env.FACE_GRPC_TIMEOUT_MS ?? 15000);

// Reason codes are user-safe and never carry scores or thresholds. The frontend maps them to
// localised text; these messages are the fallback for other clients.
const HINTS = {
  sunglasses: 'Please remove your sunglasses or mask.',
  mask: 'Please remove your sunglasses or mask.',
  hand: 'Keep your hands away from your face.',
  other: 'Make sure nothing is covering your face.',
  multiple_faces: 'Make sure only you are in the frame.',
  no_face: 'Keep your face in view.',
  face_lost: 'Keep your face in view.',
  face_too_small: 'Move closer to the camera.',
  too_dark: 'It is too dark. Face a light.',
  too_bright: 'It is too bright. Avoid strong light behind or on your face.',
  too_blurry: 'The picture was blurry. Hold still.',
  not_neutral: 'Relax your face and look at the camera.',
  motion_insufficient: 'Move your head a little further.',
  bad_frame_count: 'Something went wrong with the capture. Please try again.',
  bad_image: 'Something went wrong with the capture. Please try again.',
  verification_failed: 'Verification failed. Please try again using the live camera.',
};
// Gates whose name would help someone probing the system; the client only sees a generic code.
const HIDDEN_GATES = new Set(['liveness', 'face_changed_during_session', 'bad_timestamps', 'motion_too_fast']);
const publicReason = (code) => (HIDDEN_GATES.has(code) ? 'verification_failed' : code);

// Memory storage only: frames are never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 400 * 1024, files: MAX_FRAMES, fields: 6 },
  fileFilter: (req, file, cb) =>
    file.mimetype === 'image/jpeg' ? cb(null, true) : cb(new Error('jpeg_only')),
});

// Request-rate guard against hammering (runs after requireAuth, so it is per user). The verdict
// limits below are the ones that matter for honest users.
const limiter = (prefix) =>
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.FACE_RATE_LIMIT ?? 20),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.sub),
    store: new RedisStore({
      prefix: `rl:face:${prefix}:`,
      sendCommand: (...args) => redis.call(...args),
    }),
  });

const outcomeKey = (kind, userId) => `rl:face:outcome:${kind}:${userId}`;

// Returns seconds to wait if the user is over a verdict limit, else 0.
async function blockedFor(userId) {
  for (const [kind, limit] of [['retry', RETRY_LIMIT], ['spoof', SPOOF_LIMIT]]) {
    const n = Number(await redis.get(outcomeKey(kind, userId)) ?? 0);
    if (n >= limit) return Math.max(await redis.ttl(outcomeKey(kind, userId)), 1);
  }
  return 0;
}

async function recordOutcome(kind, userId) {
  const key = outcomeKey(kind, userId);
  await redis.multi().incr(key).expire(key, OUTCOME_WINDOW, 'NX').exec();
}

// Retry-After (seconds) drives the countdown on the client; retryAfterSec stays for older clients.
const tooMany = (res, wait) => res.set('Retry-After', String(wait)).status(429).json({ error: 'too_many_attempts', retryAfterSec: wait });

// Per-frame labels travel as one JSON field, in the same order as the uploaded files.
function parseMeta(raw, count) {
  let meta;
  try { meta = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(meta) || meta.length !== count) return null;
  const out = [];
  for (const m of meta) {
    if (!PHASES.has(m?.phase) || !Number.isFinite(m?.ts)) return null;
    out.push({ phase: m.phase, clientTsMs: Math.max(0, Math.min(Math.round(m.ts), 2 ** 31 - 1)) });
  }
  return out;
}

const router = Router();
router.use(requireAuth);

router.post('/session', limiter('session'), async (req, res, next) => {
  try {
    const wait = await blockedFor(req.user.sub);
    if (wait) return tooMany(res, wait);

    const sessionId = crypto.randomUUID();
    const challenge = CHALLENGES[crypto.randomInt(CHALLENGES.length)];
    await redis.set(
      `face:session:${sessionId}`,
      JSON.stringify({ userId: String(req.user.sub), challenge }),
      'EX', SESSION_TTL,
    );
    res.json({ sessionId, challenge, expiresIn: SESSION_TTL });
  } catch (err) {
    next(err);
  }
});

router.post('/verify', limiter('verify'), upload.array('frames', MAX_FRAMES), async (req, res, next) => {
  const lockKey = `face:lock:${String(req.body.sessionId ?? '')}`;
  let locked = false;
  try {
    const sessionId = String(req.body.sessionId ?? '');
    const files = req.files ?? [];
    const meta = parseMeta(req.body.meta, files.length);
    if (!sessionId || files.length < MIN_FRAMES || !meta) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const promptTsMs = Math.max(0, Math.round(Number(req.body.promptTs) || 0));
    const restarts = Math.max(0, Math.min(Math.round(Number(req.body.restarts) || 0), MAX_RESTARTS));

    const wait = await blockedFor(req.user.sub);
    if (wait) return tooMany(res, wait);

    const sessionKey = `face:session:${sessionId}`;
    const raw = await redis.get(sessionKey);
    if (!raw) return res.status(410).json({ error: 'session_expired' });
    const session = JSON.parse(raw);
    if (session.userId !== String(req.user.sub)) return res.status(403).json({ error: 'forbidden' });

    // One verification at a time per session, so it cannot be replayed concurrently.
    locked = (await redis.set(lockKey, '1', 'EX', Math.ceil(GRPC_TIMEOUT_MS / 1000) + 5, 'NX')) === 'OK';
    if (!locked) return res.status(409).json({ error: 'verification_in_progress' });

    let result;
    try {
      result = await enroll({
        userId: session.userId,
        sessionId,
        challenge: session.challenge,
        frames: files.map((f, i) => ({ data: f.buffer, ...meta[i] })),
        promptTsMs,
        restarts,
      }, GRPC_TIMEOUT_MS);
    } catch (err) {
      // 503 / timeout: the ML service gave no verdict, so the session stays usable for a retry.
      console.error('face service error', err);
      return res.status(503).json({ status: 'RETRY', reason: 'service_unavailable', message: 'Please try again in a moment.' });
    }

    // A verdict exists: the session is single use from here on.
    await redis.del(sessionKey);

    // Never return top_similarity or liveness_score in production: it helps attackers
    // probe thresholds. In DEV_MODE they are included under `debug` for testing.
    const debug = process.env.DEV_MODE === 'true'
      ? { debug: { verdict: result.verdict, reason: result.reasonCode, topSimilarity: result.topSimilarity, liveness: result.livenessScore, challenge: session.challenge } }
      : {};
    switch (result.verdict) {
      case 'ACCEPTED':
        // await markUserFaceVerified(session.userId);   // update your users table
        return res.json({ status: 'VERIFIED', ...debug });
      case 'DUPLICATE':
        return res.json({ status: 'DUPLICATE', reason: 'duplicate', message: 'This face is already linked to another account.', ...debug });
      case 'ALREADY_VERIFIED':
        return res.json({ status: 'ALREADY_VERIFIED', reason: 'already_verified', message: 'This account is already face-verified.', ...debug });
      case 'REVIEW':
        return res.json({ status: 'IN_REVIEW', reason: 'review', message: 'We need to review your verification. This usually takes a short while.', ...debug });
      case 'REJECTED_SPOOF': {
        await recordOutcome('spoof', session.userId);
        const reason = publicReason(result.reasonCode) || 'verification_failed';
        return res.json({ status: 'FAILED', reason, message: HINTS[reason] ?? HINTS.verification_failed, ...debug });
      }
      default: {
        await recordOutcome('retry', session.userId);
        const reason = publicReason(result.reasonCode) || 'unknown';
        return res.json({ status: 'RETRY', reason, message: HINTS[reason] ?? 'Please try again.', ...debug });
      }
    }
  } catch (err) {
    next(err);
  } finally {
    if (locked) await redis.del(lockKey).catch(() => {});
  }
});

export default router;
