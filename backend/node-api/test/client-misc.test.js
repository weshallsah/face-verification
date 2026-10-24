import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VERIFY_DIR, verifyModule } from './_paths.js';

const { initAuth, getToken } = await verifyModule('auth.js');
const { createBridge, detectHost, SOURCE, VERSION } = await verifyModule('bridge.js');
const { parseReturnUrl } = await verifyModule('config.js');
const { parseRetryAfter, createApi } = await verifyModule('api.js');
const { PREVIEW_STATES, RESULT_IDS } = await verifyModule('preview.js');
const { default: S } = await verifyModule('strings.en.js');
const { preloadUrls } = await verifyModule('preload.js');

// ---- auth ---------------------------------------------------------------------------------------------------
test('token comes from the URL fragment, is kept in memory, and is removed from the URL', () => {
  const calls = [];
  const ok = initAuth({
    location: { hash: '#token=abc.def.ghi&x=1', search: '?returnUrl=https%3A%2F%2Fa.example', pathname: '/verify' },
    history: { replaceState: (...a) => calls.push(a) },
  });
  assert.equal(ok, true);
  assert.equal(getToken(), 'abc.def.ghi');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], '/verify?returnUrl=https%3A%2F%2Fa.example#x=1');
  assert.ok(!calls[0][2].includes('abc'));
});

test('a ?token= query parameter is ignored and scrubbed', () => {
  const calls = [];
  initAuth({ location: { hash: '', search: '?token=evil&keep=1', pathname: '/verify' }, history: { replaceState: (...a) => calls.push(a) } });
  assert.equal(getToken(), 'abc.def.ghi');                 // unchanged from the previous test: the query value was NOT taken
  assert.equal(calls[0][2], '/verify?keep=1');
});

test('the token is never written to localStorage / sessionStorage / cookies', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(VERIFY_DIR, 'js'))) {
    const src = fs.readFileSync(f, 'utf8');
    // The only storage use allowed is the DEV-only auto test user id (not a credential).
    const uses = src.match(/(localStorage|sessionStorage)\.\w+|document\.cookie/g) ?? [];
    assert.ok(uses.every((u) => u === 'localStorage.devUid'), `${f}: ${uses}`);
    const lines = (src.match(/.*(localStorage|sessionStorage|document\.cookie).*/g) ?? []).join(' ');
    assert.ok(!/token/i.test(lines), f);
  }
});

// ---- bridge -------------------------------------------------------------------------------------------------
test('React Native: JSON string via ReactNativeWebView.postMessage', () => {
  const got = [];
  const win = { ReactNativeWebView: { postMessage: (m) => got.push(m) } };
  const b = createBridge({ win });
  assert.equal(b.emit('verification_finished', { verdict: 'VERIFIED' }), 'react-native');
  assert.deepEqual(JSON.parse(got[0]), { source: SOURCE, version: VERSION, event: 'verification_finished', data: { verdict: 'VERIFIED' } });
  assert.equal(typeof got[0], 'string');
});

test('Android: JSON string via AndroidBridge.postMessage', () => {
  const got = [];
  const b = createBridge({ win: { AndroidBridge: { postMessage: (m) => got.push(m) } } });
  b.emit('camera_denied');
  assert.equal(typeof got[0], 'string');
  assert.deepEqual(JSON.parse(got[0]), { source: 'face-verification', version: 1, event: 'camera_denied', data: {} });
});

test('iOS: the object itself via webkit.messageHandlers.faceVerification', () => {
  const got = [];
  const b = createBridge({ win: { webkit: { messageHandlers: { faceVerification: { postMessage: (m) => got.push(m) } } } } });
  assert.equal(b.emit('closed', { reason: 'done', verdict: 'DUPLICATE' }), 'ios');
  assert.deepEqual(got[0], { source: 'face-verification', version: 1, event: 'closed', data: { reason: 'done', verdict: 'DUPLICATE' } });
});

test('host detection order: React Native, Android, iOS, web', () => {
  const rn = { postMessage() {} };
  assert.equal(detectHost({ ReactNativeWebView: rn, AndroidBridge: rn }), 'react-native');
  assert.equal(detectHost({ AndroidBridge: rn }), 'android');
  assert.equal(detectHost({}), 'web');
});

test('plain web: only `closed` redirects, to the validated returnUrl, with the verdict attached', () => {
  const nav = [];
  const win = { location: { assign: (u) => nav.push(u) } };
  const b = createBridge({ win, returnUrl: 'https://app.example/done?x=1' });
  b.emit('verification_finished', { verdict: 'VERIFIED' });
  b.emit('camera_denied');
  assert.deepEqual(nav, []);
  b.emit('closed', { reason: 'done', verdict: 'VERIFIED' });
  assert.deepEqual(nav, ['https://app.example/done?x=1&fv_verdict=VERIFIED']);
  const none = createBridge({ win });
  none.emit('closed', { reason: 'done' });
  assert.equal(nav.length, 1);
});

test('a throwing host never breaks the page', () => {
  const b = createBridge({ win: { ReactNativeWebView: { postMessage() { throw new Error('host gone'); } } } });
  const orig = console.error; console.error = () => {};
  try { assert.doesNotThrow(() => b.emit('closed', {})); } finally { console.error = orig; }
});

// ---- returnUrl allowlist ------------------------------------------------------------------------------------
test('returnUrl must match an allowlisted origin over https', () => {
  const allow = ['https://app.example'];
  const q = (u) => `?returnUrl=${encodeURIComponent(u)}`;
  assert.equal(parseReturnUrl(q('https://app.example/done'), allow), 'https://app.example/done');
  assert.equal(parseReturnUrl(q('https://evil.example/done'), allow), null);
  assert.equal(parseReturnUrl(q('https://app.example.evil.com/'), allow), null);
  assert.equal(parseReturnUrl(q('https://app.example@evil.com/'), allow), null);
  assert.equal(parseReturnUrl(q('https://user:pw@app.example/'), allow), null);
  assert.equal(parseReturnUrl(q('http://app.example/'), allow), null);
  assert.equal(parseReturnUrl(q('javascript:alert(1)'), allow), null);
  assert.equal(parseReturnUrl(q('//evil.example'), allow), null);
  assert.equal(parseReturnUrl('', allow), null);
  assert.equal(parseReturnUrl(q('https://app.example/'), []), null);
  assert.equal(parseReturnUrl(q('http://localhost:3000/x'), ['http://localhost:3000'], false), null);
  assert.equal(parseReturnUrl(q('http://localhost:3000/x'), ['http://localhost:3000'], true), 'http://localhost:3000/x');
});

// ---- api ----------------------------------------------------------------------------------------------------
test('Retry-After: seconds or an HTTP date', () => {
  assert.equal(parseRetryAfter('120'), 120);
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:02:00 GMT', Date.parse('2026-01-01T00:00:00Z')), 120);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
});

test('api: reads Retry-After, survives non-JSON 429 bodies, and reports network errors without throwing', async () => {
  const res429 = { status: 429, headers: new Headers({ 'Retry-After': '75' }), json: async () => { throw new Error('not json'); } };
  const api = createApi({ fetchFn: async () => res429, getToken: () => 't' });
  assert.deepEqual(await api.createSession(), { httpStatus: 429, body: {}, retryAfterSec: 75 });

  let auth;
  const api2 = createApi({ fetchFn: async (u, init) => { auth = init.headers.Authorization; return { status: 200, headers: new Headers(), json: async () => ({ ok: 1 }) }; }, getToken: () => 'tok' });
  await api2.createSession();
  assert.equal(auth, 'Bearer tok');

  const api3 = createApi({ fetchFn: async () => { throw new TypeError('offline'); }, getToken: () => 't' });
  assert.deepEqual(await api3.verify(null), { error: 'network' });

  const api4 = createApi({ fetchFn: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))), getToken: () => 't', verifyTimeoutMs: 20 });
  assert.deepEqual(await api4.verify(null), { error: 'timeout' });
});

// ---- strings, preview ---------------------------------------------------------------------------------------
test('preview covers every result screen, every camera state and every non-camera screen', () => {
  for (const id of RESULT_IDS) assert.ok(PREVIEW_STATES.includes(`r-${id}`), id);
  for (const s of ['welcome', 'tutorial', 'perm', 'permDenied', 'starting', 'unsupported', 'rotate', 'processing',
    'cam-search', 'cam-closer', 'cam-back', 'cam-centre', 'cam-dark', 'cam-cover', 'cam-multi', 'cam-hold', 'cam-move', 'cam-return', 'cam-captured', 'cam-retry']) {
    assert.ok(PREVIEW_STATES.includes(s), s);
  }
});

test('the live messages and states the code uses all have text', () => {
  for (const k of ['fit', 'closer', 'back', 'centre', 'multi', 'dark', 'bright', 'lookStraight', 'relax', 'openEyes', 'hold', 'move', 'keepGoing', 'returnGreat', 'captured', 'retry']) {
    assert.ok(S.camera.msg[k], k);
  }
  for (const k of ['unsupported', 'noCamera', 'cameraBusy', 'cameraFailed', 'loadFailed', 'rotate']) assert.ok(S.states[k].title, k);
});

test('approved privacy copy', () => {
  const all = JSON.stringify(S);
  assert.ok(S.welcome.cards.some((c) => c.title === 'Only a face code is kept, not your photo.' && c.text === "It's used only to make sure each person has one account."));
  assert.ok(S.permission.points.includes('No photos or video are recorded or saved.'));
  assert.ok(!/secure face code/i.test(all));
  assert.ok(!/ask us to delete/i.test(all));
  assert.ok(!all.includes('Nothing is recorded or saved'));
});

test('no user-facing text outside strings.en.js: components and screens contain no capitalised sentences in code', () => {
  const dirs = ['components', 'screens'].map((d) => path.join(VERIFY_DIR, 'js', d));
  for (const d of dirs) for (const f of fs.readdirSync(d)) {
    const src = fs.readFileSync(path.join(d, f), 'utf8').replace(/\/\/.*$/gm, '');
    // textContent / h() children given as a literal with a letter
    assert.ok(!/(textContent\s*=\s*|h\([^)]*,\s*(null|\{[^}]*\}),\s*)'[A-Za-z]{3,}/.test(src), f);
  }
});

test('preload targets the MediaPipe files the capture module uses', () => {
  const urls = preloadUrls(true);
  assert.ok(urls.includes('/models/face_landmarker.task'));
  assert.ok(urls.some((u) => u.endsWith('vision_wasm_internal.wasm')));
  assert.ok(preloadUrls(false).some((u) => u.endsWith('vision_wasm_nosimd_internal.wasm')));
  for (const u of urls) assert.ok(fs.existsSync(path.join(VERIFY_DIR, '..', u)), u);
});
