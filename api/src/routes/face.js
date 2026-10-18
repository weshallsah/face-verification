import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../redis.js';
import { enroll } from '../grpc.js';
import { requireAuth } from '../auth.js';

const CHALLENGES = ['BLINK', 'TURN_LEFT', 'TURN_RIGHT'];
const SESSION_TTL = 120;           // seconds
const MIN_FRAMES = 5;
const MAX_FRAMES = 8;

// Map server reason codes to user-facing hints (localise these in the app).
const HINTS = {
  sunglasses: 'Please remove your sunglasses.',
  mask: 'Please remove anything covering your face.',
  hand: 'Keep your hands away from your face.',
  multiple_faces: 'Make sure only you are in the frame.',
  no_face: 'We could not see your face. Try again in better light.',
  face_too_small: 'Move a little closer to the camera.',
  not_neutral_or_low_quality: 'Hold still, relax your face and look at the camera.',
};

// Memory storage only: frames are never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 400 * 1024, files: MAX_FRAMES, fields: 4 },
  fileFilter: (req, file, cb) =>
    file.mimetype === 'image/jpeg' ? cb(null, true) : cb(new Error('jpeg_only')),
});

// Runs after requireAuth, so the limit is per user.
const limiter = (prefix) =>
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.FACE_RATE_LIMIT ?? 5),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.sub),
    store: new RedisStore({
      prefix: `rl:face:${prefix}:`,
      sendCommand: (...args) => redis.call(...args),
    }),
  });

const router = Router();
router.use(requireAuth);

router.post('/session', limiter('session'), async (req, res, next) => {
  try {
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
  try {
    const sessionId = String(req.body.sessionId ?? '');
    const frames = (req.files ?? []).map((f) => f.buffer);
    if (!sessionId || frames.length < MIN_FRAMES) {
      return res.status(400).json({ error: 'bad_request' });
    }

    // Single use: GETDEL is atomic, so a session can't be replayed.
    const raw = await redis.getdel(`face:session:${sessionId}`);
    if (!raw) return res.status(410).json({ error: 'session_expired' });
    const session = JSON.parse(raw);
    if (session.userId !== String(req.user.sub)) return res.status(403).json({ error: 'forbidden' });

    let result;
    try {
      result = await enroll({ userId: session.userId, sessionId, challenge: session.challenge, frames });
    } catch (err) {
      console.error('face service error', err);
      return res.status(503).json({ status: 'RETRY', message: 'Please try again in a moment.' });
    }

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
        return res.json({ status: 'DUPLICATE', message: 'This face is already linked to another account.', ...debug });
      case 'ALREADY_VERIFIED':
        return res.json({ status: 'ALREADY_VERIFIED', message: 'This account is already face-verified.', ...debug });
      case 'REVIEW':
        return res.json({ status: 'IN_REVIEW', message: 'We need to review your verification. This usually takes a short while.', ...debug });
      case 'REJECTED_SPOOF':
        return res.json({ status: 'FAILED', message: 'Verification failed. Please try again using the live camera.', ...debug });
      default:
        return res.json({
          status: 'RETRY',
          reason: result.reasonCode,
          message: HINTS[result.reasonCode] ?? 'Please try again.',
          ...debug,
        });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
