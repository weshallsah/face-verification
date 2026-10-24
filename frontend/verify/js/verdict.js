// API response -> which result screen to show. Pure, no DOM, no text (ids index strings.en.js S.result).
//
// Input is what api.js returns: { httpStatus, body, retryAfterSec, error } where `error` is set for
// network failures and timeouts. The reason code is looked up BEFORE the status, so for example
// motion_insufficient always shows the head-movement screen, even when the status is FAILED.

const covered = (tip) => ({ id: 'retry.covered', tip });

// reason code (server or client) -> screen. `tip` overrides the screen's default tip.
const BY_REASON = {
  motion_insufficient: { id: 'retry.movement' },
  challenge_timeout: { id: 'retry.movement' },
  too_blurry: { id: 'retry.blurry' },
  too_dark: { id: 'retry.dark' },
  too_bright: { id: 'retry.bright' },
  sunglasses: covered('covered.sunglasses'),
  mask: covered('covered.sunglasses'),
  hand: covered('covered.hand'),
  other: covered('covered.other'),
  face_too_small: { id: 'retry.far' },
  no_face: { id: 'retry.noFace' },
  face_lost: { id: 'retry.noFace' },
  neutral_timeout: { id: 'retry.noFace' },
  return_timeout: { id: 'retry.noFace' },
  multiple_faces: { id: 'retry.multi' },
  not_neutral: { id: 'retry.notNeutral' },
  // Real spoof / liveness reasons. face.js reports the hidden gates as verification_failed; the others
  // are listed in case a future server version stops hiding them.
  verification_failed: { id: 'notLive' },
  liveness: { id: 'notLive' },
  face_changed_during_session: { id: 'notLive' },
  bad_timestamps: { id: 'notLive' },
  motion_too_fast: { id: 'notLive' },
  service_unavailable: { id: 'connection' },
  duplicate: { id: 'duplicate' },
  already_verified: { id: 'already' },
  review: { id: 'review' },
};

const BY_STATUS = {
  VERIFIED: { id: 'verified' },
  DUPLICATE: { id: 'duplicate' },
  ALREADY_VERIFIED: { id: 'already' },
  IN_REVIEW: { id: 'review' },
  FAILED: { id: 'notLive' },          // REJECTED_SPOOF with a reason we do not recognise
  RETRY: { id: 'retry.generic' },     // unknown reason: generic retry message
};

export const DEFAULT_WAIT_SEC = 60;

export function resolveVerdict(res) {
  if (!res || res.error) return { id: 'connection' };            // network error or timeout
  const { httpStatus: code, body = {} } = res;
  if (code === 429) {
    const wait = res.retryAfterSec ?? body.retryAfterSec;
    return { id: 'limit', retryAfterSec: Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : DEFAULT_WAIT_SEC };
  }
  if (code === 410) return { id: 'sessionExpired' };            // handled silently by the flow
  if (code >= 500) return { id: 'connection' };
  if (!body.status) return { id: 'connection' };                 // 400 / 401 / 403 / 409 and anything unexpected
  if (body.status === 'VERIFIED') return BY_STATUS.VERIFIED;
  return BY_REASON[body.reason] ?? BY_STATUS[body.status] ?? { id: 'connection' };
}

// Failures detected in the browser before anything is uploaded (capture.js FlowError reasons).
export const resolveClientFailure = (reason) => BY_REASON[reason] ?? { id: 'retry.generic' };

// The four results that end the flow, and the verdict name sent to the host app (same words as the API status).
const FINAL = { verified: 'VERIFIED', duplicate: 'DUPLICATE', review: 'IN_REVIEW', already: 'ALREADY_VERIFIED' };
export const finalVerdict = (id) => FINAL[id] ?? null;

// The API call consumed the session whenever the server gave a verdict, or said it was gone.
export const consumesSession = (res) => !!res && !res.error && (res.httpStatus === 200 || res.httpStatus === 410 || res.httpStatus === 403);
