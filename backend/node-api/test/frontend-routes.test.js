import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { mountFrontend, publicConfig } from '../src/frontend.js';
import { FRONTEND_DIR } from './_paths.js';

async function serve(env) {
  const app = express();
  mountFrontend(app, { frontendDir: FRONTEND_DIR, env: { JWT_SECRET: 'test-secret', ...env } });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }), get: (p, opts) => fetch(base + p, opts) };
}

test('DEV_MODE off: /verify is served, every dev route is a 404', async () => {
  const s = await serve({ DEV_MODE: 'false' });
  try {
    const page = await s.get('/verify');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /html/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.ok((await s.get('/verify/')).ok);
    assert.ok((await s.get('/verify/js/main.js')).ok);
    assert.ok((await s.get('/verify/css/tokens.css')).ok);
    const root = await s.get('/', { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/verify');

    for (const p of ['/dev/token?sub=1', '/dev/test', '/dashboard.html', '/index.html', '/verify/js/preview.js', '/verify/package.json']) {
      assert.equal((await s.get(p)).status, 404, p);
    }
    const cfg = await (await s.get('/verify/config.json')).json();
    assert.equal(cfg.devMode, false);       // main.js never imports preview.js, whatever ?preview= says
  } finally { await s.close(); }
});

test('DEV_MODE unset behaves like off', async () => {
  const s = await serve({});
  try {
    assert.equal((await s.get('/dev/token?sub=1')).status, 404);
    assert.equal((await s.get('/verify/js/preview.js')).status, 404);
    assert.equal((await (await s.get('/verify/config.json')).json()).devMode, false);
  } finally { await s.close(); }
});

test('DEV_MODE on: /dev/token and the preview module exist; the old test page is gone', async () => {
  const s = await serve({ DEV_MODE: 'true' });
  try {
    assert.equal((await s.get('/dev/test')).status, 404);
    assert.equal((await s.get('/', { redirect: 'manual' })).headers.get('location'), '/verify');
    assert.equal((await s.get('/verify/js/preview.js')).status, 200);
    assert.equal((await (await s.get('/verify/config.json')).json()).devMode, true);
    assert.equal((await s.get('/dev/token?sub=abc')).status, 400);
    const { token } = await (await s.get('/dev/token?sub=1001')).json();
    assert.equal(jwt.verify(token, 'test-secret').sub, '1001');
    assert.equal((await s.get('/verify/package.json')).status, 404);
  } finally { await s.close(); }
});

test('MediaPipe files are served (always) with a long cache lifetime', async () => {
  const s = await serve({ DEV_MODE: 'false' });
  try {
    for (const p of ['/vendor/mediapipe/vision_bundle.js', '/models/face_landmarker.task']) {
      const r = await s.get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('cache-control'), /max-age=604800/);
    }
  } finally { await s.close(); }
});

test('config.json carries the deployment settings and no secrets', () => {
  const c = publicConfig({ VERIFY_APP_NAME: 'Acme', VERIFY_LOGIN_URL: 'https://a.example/login', VERIFY_SUPPORT_URL: 'https://a.example/help', VERIFY_RETURN_ALLOWLIST: 'https://a.example, https://b.example', JWT_SECRET: 'x', DEV_MODE: 'false' });
  assert.deepEqual(c.returnUrlAllowlist, ['https://a.example', 'https://b.example']);
  assert.equal(c.appName, 'Acme');
  assert.equal(c.loginUrl, 'https://a.example/login');
  assert.equal(c.supportUrl, 'https://a.example/help');
  assert.ok(!JSON.stringify(c).includes('"x"'));
  assert.deepEqual(Object.keys(c).sort(), ['appName', 'devMode', 'loginUrl', 'privacyUrl', 'returnUrlAllowlist', 'supportUrl']);
});
