// DEV_MODE only. /verify?preview=<state> jumps straight to a screen or state with mocked data, so the design
// can be checked without a camera. The server does not serve this file unless DEV_MODE=true, and main.js
// only imports it when /verify/config.json says devMode. ?preview=list shows every state.
//
// Extra query parameters: tip=<tip key> (result screens), wait=<seconds> (limit), insecure=1 (unsupported).

import { h } from './dom.js';
import { HEAD } from './icons.js';
import { createCameraScreen } from './screens/camera.js';
import { computeOval } from './components/oval-frame.js';
import { stateScreen } from './screens/states.js';
import { openPrivacySheet } from './screens/sheet.js';

export const RESULT_IDS = [
  'verified', 'duplicate', 'review', 'already', 'notLive', 'limit', 'connection',
  'retry.movement', 'retry.blurry', 'retry.dark', 'retry.bright', 'retry.covered', 'retry.far',
  'retry.noFace', 'retry.multi', 'retry.notNeutral', 'retry.generic',
];

// camera states: [phase, guidance code, lit segments, mock head {dx, dy, s} (fractions of the oval), extras]
const CAM = {
  'cam-search': ['neutral', '', [], { dx: 0.36, dy: 0.45, s: 0.86 }],
  'cam-closer': ['neutral', 'closer', [], { s: 0.58 }],
  'cam-back': ['neutral', 'back', [], { s: 1.5 }],
  'cam-centre': ['neutral', 'centre', [], { dx: 0.9, dy: -0.05 }],
  'cam-dark': ['neutral', 'dark', [], { dark: true }],
  'cam-bright': ['neutral', 'bright', [], {}],
  'cam-cover': ['neutral', 'cover', [], {}],
  'cam-multi': ['neutral', 'multi', [], { second: true }],
  'cam-coach': ['neutral', 'yaw', [], {}],
  'cam-hold': ['neutral', 'ok', [], {}],
  'cam-move': ['move', 'keep_going', [1, 2, 3], { dx: -0.15, dy: 0.15 }],
  'cam-return': ['return', '', [0, 1, 2, 3, 4, 5, 6], {}],
  'cam-captured': ['captured', '', [0, 1, 2, 3, 4, 5, 6, 7], {}],
  'cam-retry': ['retry', '', [], {}],
};

export const PREVIEW_STATES = [
  'welcome', 'privacy', 'tutorial', 'perm', 'permDenied', 'starting',
  'unsupported', 'noCamera', 'cameraBusy', 'cameraFailed', 'loadFailed', 'rotate',
  ...Object.keys(CAM), 'processing', ...RESULT_IDS.map((id) => `r-${id}`),
];

function mockScene(spec) {
  const scene = h('div', { class: 'cam-scene' });
  const head = (extra = '') => { const s = HEAD(200, 260); s.setAttribute('style', extra); return s; };
  const place = (el, o, frame, dx, dy, s) => {
    el.style.transformOrigin = '50% 41.5%';
    el.style.transform = `translate(-50%,-41.5%) translate(${dx * o.rx}px,${dy * o.ry}px) scale(${s * (o.rx / 60) * 0.88})`;
    el.style.left = 'var(--cx)'; el.style.top = 'var(--cy)';
  };
  const main = head();
  scene.append(main);
  const second = spec.second ? head('opacity:.9') : null;
  if (second) scene.append(second);
  if (spec.dark) scene.style.filter = 'brightness(.3) saturate(.6)';
  return {
    scene,
    layout(frame) {
      const o = computeOval(frame.clientWidth, frame.clientHeight);
      place(main, o, frame, spec.dx ?? 0, spec.dy ?? 0, spec.s ?? 1);
      if (second) place(second, o, frame, 1.25, -0.9, 0.55);
    },
  };
}

function cameraPreview(name, app) {
  const [phase, code, lit, spec] = CAM[name];
  const mock = mockScene(spec);
  const cs = app.mount(createCameraScreen({ onClose: () => app.screens.tutorial(), scene: mock.scene }));
  cs.view.layout();
  mock.layout(cs.view.frame.el);
  new ResizeObserver(() => mock.layout(cs.view.frame.el)).observe(cs.view.frame.el);
  cs.view.show(phase, code);
  cs.view.captureUi.ring(lit);
}

function list(app) {
  app.mount(h('main', { style: 'padding:24px;font:16px/1.6 system-ui,sans-serif;color:var(--text)' },
    h('h1', null, 'Preview states'),
    h('ul', { style: 'columns:2;list-style:none;padding:0' }, PREVIEW_STATES.map((n) => h('li', null, h('a', { href: `?preview=${n}`, style: 'color:var(--accent-text)' }, n))))));
}

export function runPreview(name, app) {
  const q = new URLSearchParams(location.search);
  const { screens, act, mount } = app;
  if (name === 'list' || !PREVIEW_STATES.includes(name)) return list(app);
  if (CAM[name]) return cameraPreview(name, app);
  if (name.startsWith('r-')) {
    return app.showResult({ id: name.slice(2), tip: q.get('tip') ?? undefined, retryAfterSec: Number(q.get('wait')) || 600 });
  }
  switch (name) {
    case 'welcome': return screens.welcome();
    case 'privacy': screens.welcome(); return openPrivacySheet({ privacyUrl: app.config.privacyUrl });
    case 'tutorial': return screens.tutorial();
    case 'perm': return screens.permission();
    case 'permDenied': return screens.denied();
    case 'starting': return app.ui.starting();
    case 'processing': return app.ui.processing();
    case 'unsupported': return mount(stateScreen('unsupported', { insecure: q.get('insecure') === '1', onPrimary: () => {} }));
    default: return mount(stateScreen(name, { onPrimary: () => act.retry() }));   // noCamera, cameraBusy, cameraFailed, loadFailed, rotate
  }
}

