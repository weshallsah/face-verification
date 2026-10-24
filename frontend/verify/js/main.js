// /verify entry point: boots config + auth, owns the screen router, and wires the flow to the screens
// and to the host app (bridge.js).

import { initAuth, getToken, setToken } from './auth.js';
import { loadConfig, parseReturnUrl } from './config.js';
import { createBridge } from './bridge.js';
import { createApi } from './api.js';
import { createSessions } from './session.js';
import { createCamera, bindPageLifecycle } from './camera-session.js';
import { createCapture } from './capture.js';
import { createFlow } from './flow.js';
import { finalVerdict } from './verdict.js';
import { warmUpWhenIdle } from './preload.js';
import { S } from './strings.js';
import { welcomeScreen } from './screens/welcome.js';
import { tutorialScreen } from './screens/tutorial.js';
import { permissionScreen, deniedScreen } from './screens/permission.js';
import { createCameraScreen } from './screens/camera.js';
import { processingScreen, startingScreen } from './screens/wait.js';
import { resultScreen } from './screens/results.js';
import { stateScreen } from './screens/states.js';
import { openPrivacySheet } from './screens/sheet.js';

async function boot() {
  // 1. The token first, before anything can leak the URL: it is read from #token=..., kept in memory, and removed from the address bar.
  initAuth();
  const config = await loadConfig();
  const returnUrl = parseReturnUrl(location.search, config.returnUrlAllowlist, config.devMode);
  const bridge = createBridge({ win: window, returnUrl });
  const root = document.getElementById('app');
  const dev = config.devMode && new URLSearchParams(location.search).get('preview');   // ?preview= exists only in DEV_MODE

  // ---- Screen router ---------------------------------------------------------------------------------
  let current = null;
  let lastVerdict = null;
  function mount(screen) {
    const s = screen instanceof Element ? { el: screen } : screen;
    current?.destroy?.();
    current = s;
    root.replaceChildren(s.el);
    s.el.focus?.({ preventScroll: true });
    return s;
  }

  // ---- Services ---------------------------------------------------------------------------------------
  async function token() {
    if (getToken() || !config.devMode) return getToken();
    // DEV_MODE only: mint a test token so the page can be opened directly.
    // ?sub= picks a user; otherwise one is made automatically and kept in this browser (dev only, it is not a credential).
    let sub = new URLSearchParams(location.search).get('sub');
    if (!sub) {
      try { sub = localStorage.devUid ||= String(1000000 + Math.floor(Math.random() * 9000000)); } catch { sub = '1001'; }
    }
    try {
      const res = await fetch(`/dev/token?sub=${encodeURIComponent(sub)}`);
      if (res.ok) setToken((await res.json()).token);
    } catch { /* no token: the API answers 401 and the connection screen shows */ }
    return getToken();
  }
  const api = createApi({ getToken: token });
  const sessions = createSessions({ api });
  const camera = createCamera();
  const capture = createCapture();

  // ---- Leaving the flow ----------------------------------------------------------------------------------
  const go = (name) => screens[name]();
  function finish(reason) {
    bridge.emit('closed', { reason, ...(lastVerdict ? { verdict: lastVerdict } : {}) });
    if (bridge.host() === 'web' && !returnUrl && history.length > 1) history.back();
  }
  function openExternal(url, event) {
    bridge.emit(event, { url });
    if (event === 'login_requested') location.assign(url);
    else if (!window.open(url, '_blank', 'noopener')) location.assign(url);
  }

  const act = {
    continue: () => finish('done'),
    login: () => openExternal(config.loginUrl, 'login_requested'),
    appeal: () => openExternal(config.supportUrl, 'support_requested'),   // placeholder URL until configured
    retry: () => flow.start(),
    tips: () => go('tutorial'),
  };

  function showResult(outcome) {
    mount(resultScreen(outcome, act));
    const verdict = finalVerdict(outcome.id);
    if (verdict) { lastVerdict = verdict; bridge.emit('verification_finished', { verdict }); }
  }

  function closeCamera() {
    flow.cancel();
    go('tutorial');
  }

  // ---- Flow <-> screens ------------------------------------------------------------------------------
  const ui = {
    starting: () => mount(startingScreen()),
    cameraScreen() {
      const cs = mount(createCameraScreen({ onClose: closeCamera }));
      cs.view.layout();
      return cs.view;
    },
    processing: () => mount(processingScreen()),
    result: showResult,
    loadFailed: () => mount(stateScreen('loadFailed', { onPrimary: () => flow.start() })),
    cameraProblem(kind) {
      if (kind === 'cancelled') return;
      if (kind === 'denied') { bridge.emit('camera_denied'); return go('denied'); }
      if (kind === 'unsupported') return mount(stateScreen('unsupported', { insecure: !window.isSecureContext, onPrimary: () => finish('unsupported') }));
      const state = kind === 'missing' ? 'noCamera' : kind === 'busy' ? 'cameraBusy' : 'cameraFailed';
      mount(stateScreen(state, { onPrimary: () => flow.start() }));
    },
  };
  const flow = createFlow({ camera, capture, sessions, api, ui });

  const screens = {
    welcome() {
      mount(welcomeScreen({ onStart: () => go('tutorial'), onPrivacy: () => openPrivacySheet({ privacyUrl: config.privacyUrl }) }));
      warmUpWhenIdle();   // model + wasm download in the background while the privacy text is read
    },
    tutorial: () => mount(tutorialScreen({ onBack: () => go('welcome'), onOpenCamera: () => go('permission') })),
    permission: () => mount(permissionScreen({ onBack: () => go('tutorial'), onAllow: () => flow.start() })),
    denied: () => mount(deniedScreen({ appName: config.appName, onBack: () => go('tutorial'), onRetry: () => flow.start() })),
  };

  // ---- Page lifecycle: the camera is closed whenever the page is hidden or closed -----------------------
  bindPageLifecycle(window, camera, {
    onHidden() {
      if (!flow.interruptible) return;   // an upload in flight is left to finish
      flow.cancel();
      go('permission');                  // coming back, the person starts the camera again
    },
  });
  window.addEventListener('pagehide', () => capture.dispose());

  // ---- Rotating a phone to landscape: pause, release the camera, resume upright (same session, if still valid) ----
  const landscape = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
  let rotateEl = null;
  let resume = false;
  function onOrientation() {
    if (landscape.matches) {
      if (flow.interruptible) { flow.cancel(); resume = true; }
      if (!rotateEl) { rotateEl = document.createElement('div'); rotateEl.className = 'rotate-overlay'; rotateEl.append(stateScreen('rotate')); document.body.append(rotateEl); }
    } else {
      rotateEl?.remove();
      rotateEl = null;
      if (resume) { resume = false; flow.start(); }
    }
  }
  landscape.addEventListener('change', onOrientation);

  // ---- Start -------------------------------------------------------------------------------------------------
  const hasCamera = typeof navigator.mediaDevices?.getUserMedia === 'function';
  const supported = typeof WebAssembly === 'object' && typeof createImageBitmap === 'function' && hasCamera;
  if (dev) {
    const { runPreview } = await import('./preview.js');   // not served unless DEV_MODE
    runPreview(dev, { mount, ui, act, screens, config, flow, showResult });
  } else if (!supported) {
    mount(stateScreen('unsupported', { insecure: !window.isSecureContext, onPrimary: () => finish('unsupported') }));
  } else {
    go('welcome');
  }
  onOrientation();
  document.title = S.welcome.title;
}

boot();
