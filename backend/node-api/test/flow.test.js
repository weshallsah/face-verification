import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyModule } from './_paths.js';

const { createCamera, bindPageLifecycle, classifyCameraError, CameraError } = await verifyModule('camera-session.js');
const { createFlow } = await verifyModule('flow.js');
const { createSessions } = await verifyModule('session.js');
const { FlowError } = await verifyModule('errors.js');

// ---- fakes ----------------------------------------------------------------------------------------------
function fakeStream() {
  const tracks = [{ stopped: 0, stop() { this.stopped++; } }, { stopped: 0, stop() { this.stopped++; } }];
  return { tracks, getTracks: () => tracks, released: () => tracks.every((t) => t.stopped >= 1) };
}

function setup({ run, model, session, verify, getUserMedia } = {}) {
  const streams = [];
  const mediaDevices = {
    getUserMedia: getUserMedia ?? (async () => { const s = fakeStream(); streams.push(s); return s; }),
  };
  const camera = createCamera({ mediaDevices });
  const events = [];
  const calls = { createSession: 0, verify: 0, openAtVerify: null };
  const api = {
    createSession: session ?? (async () => { calls.createSession++; return { httpStatus: 200, body: { sessionId: `s${calls.createSession}`, challenge: 'HEAD_MOTION', expiresIn: 300 } }; }),
    verify: async (form) => { calls.verify++; calls.openAtVerify = camera.activeCount; return verify ? verify(form) : { httpStatus: 200, body: { status: 'VERIFIED' } }; },
  };
  if (session) { const inner = session; api.createSession = async () => { calls.createSession++; return inner(); }; }
  const capture = {
    aborts: 0, rejectRun: null,
    ensureLandmarker: model ?? (async () => {}),
    setView() {},
    run: run ?? (async () => ({ frames: [], promptTs: 0, restarts: 0 })),
    abort() { this.aborts++; this.rejectRun?.(new FlowError('aborted')); },
  };
  const ui = {
    starting: () => events.push('starting'),
    cameraScreen: () => { events.push('camera'); return { video: {}, stageEl: {}, captureUi: {}, freeze: () => events.push('freeze'), captured: () => events.push('captured') }; },
    processing: () => events.push('processing'),
    result: (o) => events.push(`result:${o.id}`),
    cameraProblem: (k) => events.push(`cameraProblem:${k}`),
    loadFailed: () => events.push('loadFailed'),
  };
  const delays = [];
  const sessions = createSessions({ api });
  const flow = createFlow({
    camera, capture, sessions, api, ui,
    attach: async () => {}, makeForm: () => ({}), delay: async (ms) => { delays.push(ms); }, now: () => 0,
  });
  return { flow, camera, capture, sessions, events, calls, streams, delays };
}

const allReleased = (streams) => streams.length > 0 && streams.every((s) => s.released());

// ---- camera tracks are released on every exit path -------------------------------------------------------
test('success: tracks are released BEFORE the upload starts', async () => {
  const t = setup();
  await t.flow.start();
  assert.equal(t.calls.openAtVerify, 0, 'no stream was open when verify was called');
  assert.ok(allReleased(t.streams));
  assert.deepEqual(t.events, ['starting', 'camera', 'freeze', 'captured', 'processing', 'result:verified']);
});

test('capture timeout: tracks released, retry screen shown', async () => {
  const t = setup({ run: async () => { throw new FlowError('neutral_timeout'); } });
  await t.flow.start();
  assert.ok(allReleased(t.streams));
  assert.equal(t.events.at(-1), 'result:retry.noFace');
  assert.equal(t.calls.verify, 0);
});

test('unexpected capture error: tracks released, generic retry', async () => {
  const t = setup({ run: async () => { throw new Error('boom'); } });
  await t.flow.start();
  assert.ok(allReleased(t.streams));
  assert.equal(t.events.at(-1), 'result:retry.generic');
});

test('cancel during capture (close button, rotate, tab hidden): tracks released, no result shown', async () => {
  let t;
  t = setup({ run: () => new Promise((_, rej) => { t.capture.rejectRun = rej; }) });
  const done = t.flow.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.camera.activeCount, 1, 'camera is open while capturing');
  t.flow.cancel();
  await done;
  assert.ok(allReleased(t.streams));
  assert.equal(t.camera.activeCount, 0);
  assert.ok(!t.events.some((e) => e.startsWith('result')));
});

test('cancel while the permission prompt is still open: the late stream is stopped, not leaked', async () => {
  let resolveMedia;
  const stream = fakeStream();
  const t = setup({ getUserMedia: () => new Promise((r) => { resolveMedia = r; }) });
  const done = t.flow.start();
  await new Promise((r) => setTimeout(r, 10));
  t.flow.cancel();
  resolveMedia(stream);
  await done;
  assert.ok(stream.released());
  assert.ok(!t.events.includes('camera'));
});

test('camera refused: reported, nothing left open', async () => {
  const t = setup({ getUserMedia: async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; } });
  await t.flow.start();
  assert.deepEqual(t.events.at(-1), 'cameraProblem:denied');
  assert.equal(t.camera.activeCount, 0);
});

test('model fails to load while the camera opened: camera is closed', async () => {
  const t = setup({ model: async () => { throw new Error('wasm'); } });
  await t.flow.start();
  assert.ok(allReleased(t.streams));
  assert.equal(t.events.at(-1), 'loadFailed');
});

test('session call fails (429): camera closed, countdown screen', async () => {
  const t = setup({ session: async () => ({ httpStatus: 429, body: {}, retryAfterSec: 120 }) });
  await t.flow.start();
  assert.ok(allReleased(t.streams));
  assert.equal(t.events.at(-1), 'result:limit');
});

test('network error on upload: connection screen (camera was already closed)', async () => {
  const t = setup({ verify: async () => ({ error: 'network' }) });
  await t.flow.start();
  assert.ok(allReleased(t.streams));
  assert.equal(t.events.at(-1), 'result:connection');
});

// ---- processing screen, sessions ------------------------------------------------------------------------
test('processing screen is held for 1.5 s when the answer is instant', async () => {
  const t = setup();
  await t.flow.start();
  assert.ok(t.delays.includes(1500), `delays: ${t.delays}`);
});

test('410 session_expired: a new session is made silently and the camera comes back, no error shown', async () => {
  let n = 0;
  const t = setup({ verify: async () => (++n === 1 ? { httpStatus: 410, body: { error: 'session_expired' } } : { httpStatus: 200, body: { status: 'VERIFIED' } }) });
  await t.flow.start();
  assert.equal(t.calls.createSession, 2);
  assert.equal(t.events.filter((e) => e === 'camera').length, 2);
  assert.ok(!t.events.some((e) => e === 'result:sessionExpired' || e === 'result:connection'));
  assert.equal(t.events.at(-1), 'result:verified');
  assert.ok(allReleased(t.streams));
});

test('410 forever: gives up after two silent retries with the connection screen', async () => {
  const t = setup({ verify: async () => ({ httpStatus: 410, body: {} }) });
  await t.flow.start();
  assert.equal(t.calls.createSession, 3);
  assert.equal(t.events.at(-1), 'result:connection');
  assert.ok(allReleased(t.streams));
});

test('rotate: cancel then start again REUSES the session (no second /session call)', async () => {
  let t;
  let first = true;
  t = setup({ run: () => (first ? new Promise((_, rej) => { first = false; t.capture.rejectRun = rej; }) : Promise.resolve({ frames: [], promptTs: 0, restarts: 0 })) });
  const a = t.flow.start();
  await new Promise((r) => setTimeout(r, 10));
  t.flow.cancel();
  await a;
  await t.flow.start();
  assert.equal(t.calls.createSession, 1);
  assert.equal(t.events.at(-1), 'result:verified');
  assert.ok(allReleased(t.streams));
});

test('a verdict uses the session up: Try again makes a new one', async () => {
  const t = setup({ verify: async () => ({ httpStatus: 200, body: { status: 'RETRY', reason: 'too_dark' } }) });
  await t.flow.start();
  await t.flow.start();
  assert.equal(t.calls.createSession, 2);
});

test('an expired session is not reused', async () => {
  let clock = 0;
  const calls = { n: 0 };
  const api = { createSession: async () => { calls.n++; return { httpStatus: 200, body: { sessionId: `s${calls.n}`, challenge: 'HEAD_MOTION', expiresIn: 300 } }; } };
  const sessions = createSessions({ api, now: () => clock });
  await sessions.acquire();
  clock = 100_000;
  await sessions.acquire();
  assert.equal(calls.n, 1);
  clock = 250_000;                      // less than 60 s left
  await sessions.acquire();
  assert.equal(calls.n, 2);
});

test('interruptible only until the upload starts', async () => {
  let t;
  let release;
  t = setup({ verify: () => new Promise((r) => { release = r; }) });
  const done = t.flow.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.flow.running, true);
  assert.equal(t.flow.interruptible, false, 'frames are on their way');
  release({ httpStatus: 200, body: { status: 'VERIFIED' } });
  await done;
});

// ---- camera-session itself --------------------------------------------------------------------------------
test('releaseAll is idempotent and stops every track once', async () => {
  const s = fakeStream();
  const cam = createCamera({ mediaDevices: { getUserMedia: async () => s } });
  const h = await cam.open();
  cam.releaseAll(); cam.releaseAll(); h.release();
  assert.deepEqual(s.tracks.map((x) => x.stopped), [1, 1]);
});

test('opening a second stream closes the first', async () => {
  const streams = [];
  const cam = createCamera({ mediaDevices: { getUserMedia: async () => { const s = fakeStream(); streams.push(s); return s; } } });
  await cam.open();
  await cam.open();
  assert.ok(streams[0].released());
  assert.equal(cam.activeCount, 1);
});

test('unsupported browsers and error names are classified', async () => {
  const cam = createCamera({ mediaDevices: undefined });
  await assert.rejects(() => cam.open(), (e) => e instanceof CameraError && e.kind === 'unsupported');
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(classifyCameraError({ name: 'NotFoundError' }), 'missing');
  assert.equal(classifyCameraError({ name: 'NotReadableError' }), 'busy');
  assert.equal(classifyCameraError({ name: 'Weird' }), 'unknown');
});

test('page lifecycle: pagehide and a hidden tab close the camera', async () => {
  const win = new EventTarget();
  win.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const s1 = fakeStream(), s2 = fakeStream();
  const queue = [s1, s2];
  const cam = createCamera({ mediaDevices: { getUserMedia: async () => queue.shift() } });
  let hidden = 0;
  const unbind = bindPageLifecycle(win, cam, { onHidden: () => hidden++ });

  await cam.open();
  win.dispatchEvent(new Event('pagehide'));
  assert.ok(s1.released());

  await cam.open();
  win.document.visibilityState = 'hidden';
  win.document.dispatchEvent(new Event('visibilitychange'));
  assert.ok(s2.released());
  assert.equal(hidden, 2);

  unbind();
});
