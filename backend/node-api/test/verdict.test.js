import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyModule } from './_paths.js';

const { resolveVerdict, resolveClientFailure, finalVerdict, consumesSession } = await verifyModule('verdict.js');
const { default: S } = await verifyModule('strings.en.js');

const ok = (body, extra = {}) => ({ httpStatus: 200, body, ...extra });
const id = (res) => resolveVerdict(res).id;

test('terminal statuses', () => {
  assert.equal(id(ok({ status: 'VERIFIED' })), 'verified');
  assert.equal(id(ok({ status: 'DUPLICATE', reason: 'duplicate' })), 'duplicate');
  assert.equal(id(ok({ status: 'IN_REVIEW', reason: 'review' })), 'review');
  assert.equal(id(ok({ status: 'ALREADY_VERIFIED', reason: 'already_verified' })), 'already');
});

test('RETRY reason codes map to their own screen and tip', () => {
  const cases = {
    motion_insufficient: ['retry.movement'],
    too_blurry: ['retry.blurry'], too_dark: ['retry.dark'], too_bright: ['retry.bright'],
    sunglasses: ['retry.covered', 'covered.sunglasses'], mask: ['retry.covered', 'covered.sunglasses'],
    hand: ['retry.covered', 'covered.hand'], other: ['retry.covered', 'covered.other'],
    face_too_small: ['retry.far'],
    no_face: ['retry.noFace'], face_lost: ['retry.noFace'],
    multiple_faces: ['retry.multi'], not_neutral: ['retry.notNeutral'],
  };
  for (const [reason, [screen, tip]] of Object.entries(cases)) {
    const r = resolveVerdict(ok({ status: 'RETRY', reason }));
    assert.equal(r.id, screen, reason);
    assert.equal(r.tip, tip, reason);
  }
});

test('unknown RETRY reasons fall back to the generic retry screen', () => {
  assert.equal(id(ok({ status: 'RETRY', reason: 'something_new' })), 'retry.generic');
  assert.equal(id(ok({ status: 'RETRY', reason: 'bad_frame_count' })), 'retry.generic');
  assert.equal(id(ok({ status: 'RETRY' })), 'retry.generic');
});

test('reason code wins over status: FAILED + motion_insufficient is a head-movement retry, not "not live"', () => {
  assert.equal(id(ok({ status: 'FAILED', reason: 'motion_insufficient' })), 'retry.movement');
  assert.equal(id(ok({ status: 'FAILED', reason: 'too_dark' })), 'retry.dark');
});

test('only real spoof reasons say "not a live person"', () => {
  assert.equal(id(ok({ status: 'FAILED', reason: 'verification_failed' })), 'notLive');
  assert.equal(id(ok({ status: 'FAILED', reason: 'liveness' })), 'notLive');
  assert.equal(id(ok({ status: 'FAILED' })), 'notLive');                 // REJECTED_SPOOF, reason we do not know
  assert.notEqual(id(ok({ status: 'RETRY', reason: 'something_new' })), 'notLive');
});

test('429: Retry-After header first, then the JSON body, then a default', () => {
  assert.deepEqual(resolveVerdict({ httpStatus: 429, body: { retryAfterSec: 30 }, retryAfterSec: 600 }), { id: 'limit', retryAfterSec: 600 });
  assert.equal(resolveVerdict({ httpStatus: 429, body: { retryAfterSec: 30 } }).retryAfterSec, 30);
  assert.equal(resolveVerdict({ httpStatus: 429, body: {} }).retryAfterSec, 60);           // plain-text 429 from express-rate-limit
  assert.equal(resolveVerdict({ httpStatus: 429, body: {}, retryAfterSec: 0 }).retryAfterSec, 60);
  assert.equal(resolveVerdict({ httpStatus: 429, body: {}, retryAfterSec: 90.2 }).retryAfterSec, 91);
});

test('expired session (410) is flagged for a silent restart', () => {
  assert.equal(id({ httpStatus: 410, body: { error: 'session_expired' } }), 'sessionExpired');
});

test('network errors, timeouts, 5xx and unexpected answers are the connection problem', () => {
  assert.equal(id({ error: 'network' }), 'connection');
  assert.equal(id({ error: 'timeout' }), 'connection');
  assert.equal(id(undefined), 'connection');
  assert.equal(id({ httpStatus: 500, body: { error: 'internal_error' } }), 'connection');
  assert.equal(id({ httpStatus: 502, body: {} }), 'connection');
  assert.equal(id({ httpStatus: 503, body: { status: 'RETRY', reason: 'service_unavailable' } }), 'connection');
  assert.equal(id({ httpStatus: 400, body: { error: 'bad_request' } }), 'connection');
  assert.equal(id({ httpStatus: 401, body: {} }), 'connection');
  assert.equal(id({ httpStatus: 409, body: { error: 'verification_in_progress' } }), 'connection');
  assert.equal(id(ok({ status: 'WAT' })), 'connection');
});

test('client-side timeouts map to retry screens; unknown ones to the generic retry', () => {
  assert.equal(resolveClientFailure('neutral_timeout').id, 'retry.noFace');
  assert.equal(resolveClientFailure('return_timeout').id, 'retry.noFace');
  assert.equal(resolveClientFailure('challenge_timeout').id, 'retry.movement');
  assert.equal(resolveClientFailure('???').id, 'retry.generic');
});

test('final verdict names sent to the host', () => {
  assert.equal(finalVerdict('verified'), 'VERIFIED');
  assert.equal(finalVerdict('duplicate'), 'DUPLICATE');
  assert.equal(finalVerdict('review'), 'IN_REVIEW');
  assert.equal(finalVerdict('already'), 'ALREADY_VERIFIED');
  for (const x of ['notLive', 'limit', 'connection', 'retry.movement']) assert.equal(finalVerdict(x), null);
});

test('the session is used up by a verdict or 410, not by network trouble or 5xx', () => {
  assert.equal(consumesSession({ httpStatus: 200 }), true);
  assert.equal(consumesSession({ httpStatus: 410 }), true);
  assert.equal(consumesSession({ httpStatus: 503 }), false);
  assert.equal(consumesSession({ error: 'network' }), false);
  assert.equal(consumesSession({ httpStatus: 429 }), false);
});

test('every screen id and tip the mapping can produce has text in strings.en.js', () => {
  const ids = new Set(['verified', 'duplicate', 'review', 'already', 'notLive', 'limit', 'connection']);
  const tips = new Set();
  for (const reason of ['motion_insufficient', 'challenge_timeout', 'too_blurry', 'too_dark', 'too_bright', 'sunglasses', 'mask', 'hand', 'other', 'face_too_small', 'no_face', 'face_lost', 'neutral_timeout', 'return_timeout', 'multiple_faces', 'not_neutral', 'whatever']) {
    const r = resolveClientFailure(reason);
    ids.add(r.id);
    if (r.tip) tips.add(r.tip);
  }
  for (const i of ids) {
    const copy = S.result[i];
    assert.ok(copy?.title, `title for ${i}`);
    if (i.startsWith('retry.')) assert.ok(S.tips[copy.tip], `default tip for ${i}`);
  }
  for (const t of tips) assert.ok(S.tips[t], `tip ${t}`);
});
