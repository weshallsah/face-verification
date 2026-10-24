import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';

const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

// Everything the verification page needs to know that differs per deployment. Served as JSON so
// the page needs no rebuild. Nothing secret belongs here.
export function publicConfig(env = process.env) {
  return {
    appName: env.VERIFY_APP_NAME || 'our app',
    loginUrl: env.VERIFY_LOGIN_URL || '/login',                          // "Log in to my account"
    supportUrl: env.VERIFY_SUPPORT_URL || 'https://example.com/support', // "I think this is a mistake" (placeholder, set in production)
    privacyUrl: env.VERIFY_PRIVACY_URL || '',                            // full privacy policy; the link is hidden when empty
    returnUrlAllowlist: csv(env.VERIFY_RETURN_ALLOWLIST),                // origins a ?returnUrl= may point to
    devMode: env.DEV_MODE === 'true',
  };
}

const pageHeaders = {
  'Cache-Control': 'no-cache',
  'Referrer-Policy': 'no-referrer',                // the #token fragment is never sent anyway; this also hides the path
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(self)',
};

// /verify (always), /vendor + /models (always: the page loads MediaPipe from them), and the dev-only
// extras (/dev/test, /dev/token, the static root) only when DEV_MODE=true.
export function mountFrontend(app, { frontendDir, env = process.env }) {
  const config = publicConfig(env);
  const dev = config.devMode;
  const verifyDir = path.join(frontendDir, 'verify');
  const heavy = { index: false, maxAge: '7d' };   // MediaPipe wasm + model: big, rarely change

  app.use('/vendor', express.static(path.join(frontendDir, 'vendor'), heavy));
  app.use('/models', express.static(path.join(frontendDir, 'models'), heavy));

  app.get('/verify/config.json', (req, res) => {
    res.set('Cache-Control', 'no-store').json(config);
  });

  // The preview harness (?preview=) is a separate module that is simply not served unless DEV_MODE.
  app.use('/verify', (req, res, next) => {
    if ((!dev && req.path === '/js/preview.js') || req.path.endsWith('package.json')) return res.status(404).end();
    next();
  });

  const page = (req, res) => res.set(pageHeaders).sendFile(path.join(verifyDir, 'index.html'));
  app.get(['/verify', '/verify/'], page);
  app.use('/verify', express.static(verifyDir, {
    index: false,
    setHeaders: (res, file) => {
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', /\.woff2$/.test(file) ? 'public, max-age=2592000' : 'no-cache');
    },
  }));

  if (dev) {
    // Old test page, kept as a dev-only reference (see the comment at the top of frontend/index.html).
    app.get('/dev/test', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
    app.get('/dev/token', (req, res) => {
      const sub = String(req.query.sub ?? '');
      if (!/^\d+$/.test(sub)) return res.status(400).json({ error: 'sub_must_be_numeric' });
      res.json({ token: jwt.sign({ sub }, env.JWT_SECRET, { expiresIn: '1h' }) });
    });
    app.use(express.static(frontendDir));   // dashboard.html and friends
  }
}
