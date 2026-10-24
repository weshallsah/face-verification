// Capture logic: a PORT of the HEAD_MOTION flow from the old test page (frontend/index.html), with the
// DOM calls replaced by the `ui` interface. Detection, timing, buffering and every threshold below are
// unchanged. The only additions are: guidance() also returns a `code`, the ring uses ring-map.js, and
// abort().
//
// The browser only handles TIMING and GUIDANCE. Everything it measures is used to decide when to
// take frames; the server re-detects on the uploaded JPEGs and makes every decision itself.
// No scores are ever sent to the server.
//
// ui (set with setView):
//   ui.phase('neutral' | 'move' | 'return' | 'retry')
//   ui.guide({ ok, code })            code: see guidance.js; '' clears it
//   ui.ring(Set<segment> | null)      segments to light; null hides the ring
//   ui.restartsLeft() is not needed: a restart is announced with phase('retry')

import { FlowError } from './errors.js';
import { MOTION_BINS, binOf, updateCal } from './motion.js';
import { litSegments } from './ring-map.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const MEDIAPIPE = '/vendor/mediapipe';
const MODEL = '/models/face_landmarker.task';

// ---- Tunables (client side; the server has its own thresholds in backend/python-face-service/app/config.py) --------
const T = {
  BUF_LONG: 640,            // stored frames: long side in px
  BUF_MAX: 30,              // ~1.5 s at 20 fps
  BUF_MIN_GAP_MS: 50,       // store at most ~20 fps
  FPS_FLOOR: 10,            // below this, shrink the detection input
  DET_STEPS: [640, 480, 320],
  MIN_FACE_PX: 140,         // server min_face_px is 120 on these 640px frames; keep a margin
  CENTRE_TOL: 0.12,         // face centre vs oval centre, as a fraction of the stage
  STEADY_MS: 500,           // neutral: hold still this long before capturing
  STEADY_DRIFT: 0.03,       // neutral: max face-centre drift while "steady"
  NEUTRAL_YAW: 10, NEUTRAL_PITCH: 12,   // server neutral gate is 15 deg
  NEUTRAL_MOUTH: 0.30,      // server neutral gate is 0.35
  NEUTRAL_EYES_CLOSED: 0.5,
  LUMA_MIN: 70, LUMA_MAX: 190,          // server brightness range is 60..200 on the face crop
  // HEAD_MOTION: same rule as the server (face_service/app/config.py motion_*). Direction, order and shape are free.
  MOTION_YAW_DEG: 10, MOTION_PITCH_DEG: 7, MOTION_BINS, MOTION_MIN_BINS: 5,
  MOTION_MARGIN: 1.1,       // the server re-measures the JPEGs; ask for a little more than its m >= 1
  MOTION_MIN_SPAN_MS: 1000, // server rejects motion shorter than 800 ms between first and last motion frame
  MOTION_TIMEOUT_MS: 10000, MAX_RESTARTS: 2,
  NEUTRAL_TIMEOUT_MS: 30000, RETURN_TIMEOUT_MS: 10000, RETURN_STEADY_MS: 300,
  RETURN_BLINK_MARGIN: 0.12,
  NEUTRAL_FRAMES: 3, NEUTRAL_GAP_MS: 200, RETURN_FRAMES: 2, RETURN_GAP_MS: 150,
  JPEG_QUALITY: 0.9,
};

export function createCapture() {
  // ---- Face landmarker ---------------------------------------------------------------------------------
  let landmarker = null, delegate = null, loading = null;

  async function createLandmarker(del) {
    // Dynamic import: the 140 kB bundle is not part of the page until the camera flow needs it.
    const { FaceLandmarker, FilesetResolver } = await import(`${MEDIAPIPE}/vision_bundle.js`);
    const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: del },
      runningMode: 'VIDEO',
      numFaces: 2,                                  // 2 so we can say "only one face please"
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  function ensureLandmarker() {
    if (landmarker) return Promise.resolve();
    loading ??= (async () => {
      let lastErr;
      for (const del of ['GPU', 'CPU']) {
        try { landmarker = await createLandmarker(del); delegate = del; return; } catch (e) { lastErr = e; }
      }
      throw lastErr;
    })().finally(() => { loading = null; });
    return loading;
  }

  // ---- Detection loop + rolling frame buffer -------------------------------------------------------------
  let video = null, stageEl = null, ui = null;
  const bufCanvas = document.createElement('canvas');
  const bufCtx = bufCanvas.getContext('2d');
  const detCanvas = document.createElement('canvas');
  const detCtx = detCanvas.getContext('2d');
  const lumaCanvas = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
  const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });

  let running = false, aborted = false, loopId = 0, detLong = T.DET_STEPS[0], lastTs = 0, lastStore = 0, lastLuma = 0, luma = null;
  let fpsCount = 0, fpsSince = 0, fpsHold = 0;
  let buffer = [];                 // {t, bitmap, blink, yaw, pitch, noseDx, noseDy, ok}
  let waiters = [];                // pending nextEntry() calls
  let onFace = null;               // current stage's per-frame handler
  let cancelStage = null;          // rejects the current stage() when abort() is called
  let sessionStart = 0;

  function scheduleFrame(cb, id) {
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) video.requestVideoFrameCallback(() => cb(id));
    else requestAnimationFrame(() => cb(id));
  }

  function readFace(res, t) {
    const n = res.faceLandmarks?.length ?? 0;
    const f = { t, n };
    if (n !== 1) return f;
    const lm = res.faceLandmarks[0];
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    f.cx = (minX + maxX) / 2; f.cy = (minY + maxY) / 2; f.w = maxX - minX; f.h = maxY - minY;
    f.minSidePx = Math.min(f.w * bufCanvas.width, f.h * bufCanvas.height);

    const sh = {};
    for (const c of res.faceBlendshapes?.[0]?.categories ?? []) sh[c.categoryName] = c.score;
    f.blink = ((sh.eyeBlinkLeft ?? 0) + (sh.eyeBlinkRight ?? 0)) / 2;
    f.mouth = Math.max(sh.jawOpen ?? 0, sh.mouthSmileLeft ?? 0, sh.mouthSmileRight ?? 0, sh.mouthPucker ?? 0, sh.mouthFunnel ?? 0);

    // Pose from the transformation matrix. The layout (row/column major) is detected from where the
    // translation sits, so this does not depend on how the bundle flattens it. Only magnitudes and
    // differences are used. The nose offset below only orients the on-screen ring.
    const d = res.facialTransformationMatrixes?.[0]?.data;
    if (d && d.length >= 16) {
      const rowMajor = Math.abs(d[3]) + Math.abs(d[7]) + Math.abs(d[11]) > Math.abs(d[12]) + Math.abs(d[13]) + Math.abs(d[14]);
      const r = (i, j) => (rowMajor ? d[i * 4 + j] : d[j * 4 + i]);
      f.yaw = Math.atan2(r(0, 2), r(2, 2)) * 180 / Math.PI;
      f.pitch = Math.atan2(-r(1, 2), Math.hypot(r(0, 2), r(2, 2))) * 180 / Math.PI;
    } else { f.yaw = 0; f.pitch = 0; }

    // Same geometry as the server (nose x relative to the eye midpoint, in eye distances) on the
    // UN-mirrored frame: > 0 means the head is turned to the subject's left.
    const eyeR = lm[33], eyeL = lm[263], nose = lm[1];
    const ipd = Math.max(Math.abs(eyeL.x - eyeR.x), 1e-3);
    f.noseDx = (nose.x - (eyeR.x + eyeL.x) / 2) / ipd;
    f.noseDy = (nose.y - (eyeR.y + eyeL.y) / 2) / ipd;
    return f;
  }

  // Face position in oval/stage coordinates (object-fit: cover). Mirroring does not matter: the
  // checks are symmetric around the stage centre.
  function stagePos(f) {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    const vw = video.videoWidth, vh = video.videoHeight;
    const sc = Math.max(W / vw, H / vh);
    return {
      x: (f.cx * vw * sc - (vw * sc - W) / 2) / W,
      y: (f.cy * vh * sc - (vh * sc - H) / 2) / H,
      h: (f.h * vh * sc) / H,
    };
  }

  function sampleLuma(f) {
    const x = Math.max(0, f.cx - f.w / 2) * bufCanvas.width, y = Math.max(0, f.cy - f.h / 2) * bufCanvas.height;
    lumaCtx.drawImage(bufCanvas, x, y, f.w * bufCanvas.width, f.h * bufCanvas.height, 0, 0, 16, 16);
    const px = lumaCtx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    luma = sum / 256;
  }

  const bad = (code) => ({ ok: false, code });

  // Is this frame a good "looking straight" frame? Returns the problem code when not. Same conditions,
  // in the same order, as the old page; only the text became a code (see guidance.js).
  function guidance(f, { maxBlink = T.NEUTRAL_EYES_CLOSED } = {}) {
    if (f.n === 0) return bad('no_face');
    if (f.n > 1) return bad('multi');
    if (f.minSidePx < T.MIN_FACE_PX) return bad('closer');
    const s = stagePos(f);
    if (s.h > 0.92) return bad('back');
    if (Math.abs(s.x - 0.5) > T.CENTRE_TOL || Math.abs(s.y - 0.5) > T.CENTRE_TOL) return bad('centre');
    if (luma !== null && luma < T.LUMA_MIN) return bad('dark');
    if (luma !== null && luma > T.LUMA_MAX) return bad('bright');
    if (Math.abs(f.yaw) > T.NEUTRAL_YAW || Math.abs(f.pitch) > T.NEUTRAL_PITCH) return bad('yaw');
    if (f.mouth > T.NEUTRAL_MOUTH) return bad('mouth');
    if (f.blink > maxBlink) return bad('eyes');
    return { ok: true, code: '' };
  }

  function pushEntry(e) {
    buffer.push(e);
    while (buffer.length > T.BUF_MAX) buffer.shift().bitmap.close();   // free evicted frames right away
    waiters = waiters.filter((w) => !w.try(e));
  }

  async function onVideoFrame(id) {
    if (!running || id !== loopId) return;          // a stale callback from a previous run
    if (video.readyState < 2 || !video.videoWidth) return scheduleFrame(onVideoFrame, id);
    const t = performance.now();

    // Downscale once for the buffer; detect on it (or on a smaller copy if the device is struggling).
    const k = Math.min(1, T.BUF_LONG / Math.max(video.videoWidth, video.videoHeight));
    const bw = Math.round(video.videoWidth * k), bh = Math.round(video.videoHeight * k);
    if (bufCanvas.width !== bw || bufCanvas.height !== bh) { bufCanvas.width = bw; bufCanvas.height = bh; }
    bufCtx.drawImage(video, 0, 0, bw, bh);   // un-mirrored
    let src = bufCanvas;
    if (detLong < T.BUF_LONG) {
      const dk = detLong / T.BUF_LONG;
      detCanvas.width = Math.round(bw * dk); detCanvas.height = Math.round(bh * dk);
      detCtx.drawImage(bufCanvas, 0, 0, detCanvas.width, detCanvas.height);
      src = detCanvas;
    }

    let res = null;
    try {
      lastTs = Math.max(Math.floor(t), lastTs + 1);
      res = landmarker.detectForVideo(src, lastTs);
    } catch (e) {
      if (delegate === 'GPU') {            // GPU delegate can fail at first use on some devices
        try { landmarker = await createLandmarker('CPU'); delegate = 'CPU'; lastTs = 0; } catch { /* surfaces as no face */ }
      }
    }

    // FPS check: shrink the detection input when we cannot keep up.
    fpsCount++;
    if (t - fpsSince >= 1000) {
      const fps = fpsCount * 1000 / (t - fpsSince);
      fpsCount = 0; fpsSince = t;
      if (fps < T.FPS_FLOOR && t > fpsHold) {
        const i = T.DET_STEPS.indexOf(detLong);
        if (i < T.DET_STEPS.length - 1) { detLong = T.DET_STEPS[i + 1]; fpsHold = t + 2000; }
      }
    }

    if (!running) return;                    // aborted while detecting
    if (res) {
      const f = readFace(res, t);
      if (f.n === 1 && t - lastLuma > 250) { lastLuma = t; sampleLuma(f); }
      if (f.n !== 1) luma = null;
      const g = guidance(f);
      if (f.n === 1 && t - lastStore >= T.BUF_MIN_GAP_MS) {
        lastStore = t;
        const meta = { t, blink: f.blink, yaw: f.yaw, pitch: f.pitch, noseDx: f.noseDx, noseDy: f.noseDy, ok: g.ok };
        createImageBitmap(bufCanvas).then((bitmap) => {
          if (running) pushEntry({ ...meta, bitmap }); else bitmap.close();
        });
      }
      f.guide = g;
      f.snapshot = () => createImageBitmap(bufCanvas);   // exactly this frame, un-mirrored, 640px
      onFace?.(f, t);
    }
    scheduleFrame(onVideoFrame, id);
  }

  function startLoop() {
    running = true; loopId++; lastTs = 0; lastStore = 0; lastLuma = 0; luma = null; detLong = T.DET_STEPS[0];
    fpsCount = 0; fpsSince = performance.now(); fpsHold = 0;
    scheduleFrame(onVideoFrame, loopId);
  }

  function stopLoop() {
    running = false; onFace = null;
    waiters = [];
    buffer.forEach((e) => e.bitmap.close());
    buffer = [];
  }

  // ---- Stage helpers -------------------------------------------------------------------------------------
  // Runs `handler(face, t)` on every detection until it returns a value (resolved) or the timeout hits.
  function stage(handler, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (aborted) return reject(new FlowError('aborted'));
      const to = setTimeout(() => { onFace = null; cancelStage = null; resolve({ timeout: true }); }, timeoutMs);
      cancelStage = () => { clearTimeout(to); onFace = null; cancelStage = null; reject(new FlowError('aborted')); };
      onFace = (f, t) => {
        const r = handler(f, t);
        if (r !== undefined) { clearTimeout(to); onFace = null; cancelStage = null; resolve(r); }
      };
    });
  }

  // Next stored frame at/after `target` (optionally only "good" frames), or null on timeout.
  function nextEntry(target, needOk, timeoutMs) {
    return new Promise((resolve) => {
      const w = { try: (e) => { if (e.t >= target && (!needOk || e.ok)) { clearTimeout(to); resolve(e); return true; } return false; } };
      const to = setTimeout(() => { waiters = waiters.filter((x) => x !== w); resolve(null); }, timeoutMs);
      waiters.push(w);
    });
  }

  const take = (e) => { buffer = buffer.filter((x) => x !== e); return e; };

  async function collectSpaced(count, gapMs, needOk) {
    const out = [];
    let target = performance.now();
    for (let i = 0; i < count; i++) {
      const e = await nextEntry(target, needOk, 2500);
      if (aborted) { e?.bitmap.close(); out.forEach((x) => x.bitmap.close()); throw new FlowError('aborted'); }
      if (!e) { out.forEach((x) => x.bitmap.close()); return null; }
      out.push(take(e));
      target = e.t + gapMs;
    }
    return out;
  }

  const encCanvas = document.createElement('canvas');
  async function encode(entries, phase) {
    const out = [];
    for (const e of entries) {
      encCanvas.width = e.bitmap.width; encCanvas.height = e.bitmap.height;
      encCanvas.getContext('2d').drawImage(e.bitmap, 0, 0);   // un-mirrored
      const blob = await new Promise((r) => encCanvas.toBlob(r, 'image/jpeg', T.JPEG_QUALITY));
      e.bitmap.close();
      out.push({ blob, phase, ts: Math.round(e.t - sessionStart) });
    }
    return out;
  }

  // ---- Stages --------------------------------------------------------------------------------------------
  async function neutralStage() {
    ui.phase('neutral');
    const deadline = performance.now() + T.NEUTRAL_TIMEOUT_MS;
    for (;;) {
      let since = null, ref = null;
      const r = await stage((f, t) => {
        ui.guide(f.guide);
        if (!f.guide.ok) { since = null; return; }
        const s = stagePos(f);
        if (since === null || Math.hypot(s.x - ref.x, s.y - ref.y) > T.STEADY_DRIFT) { since = t; ref = s; }
        if (t - since >= T.STEADY_MS) return { ok: true };
      }, Math.max(1, deadline - performance.now()));
      if (r.timeout) throw new FlowError('neutral_timeout');
      const entries = await collectSpaced(T.NEUTRAL_FRAMES, T.NEUTRAL_GAP_MS, true);
      if (entries) {
        const med = (k) => median(entries.map((e) => e[k]));
        const base = { blink: med('blink'), yaw: med('yaw'), pitch: med('pitch'), noseDx: med('noseDx'), noseDy: med('noseDy') };
        return { frames: await encode(entries, 'NEUTRAL'), base };
      }
      if (performance.now() > deadline) throw new FlowError('neutral_timeout');
    }
  }

  // ---- HEAD_MOTION ---------------------------------------------------------------------------------
  // Ring of 8 screen sectors around the oval. A sector lights when the head reaches it. It never shows
  // which sectors are missing and never says where to go next.
  async function motionStage(base, state) {
    for (;;) {
      ui.phase('move');
      ui.ring(new Set());
      ui.guide({ ok: false, code: '' });

      const best = new Map();          // raw sector -> { m, t, bitmap: Promise<ImageBitmap> } (largest magnitude so far)
      const cal = { x: 0, y: 0 };      // evidence for the on-screen orientation of yaw / pitch
      const promptT = performance.now();
      state.promptTs = Math.round(promptT - sessionStart);

      const r = await stage((f, t) => {
        if (f.n !== 1) return;
        const dyaw = f.yaw - base.yaw, dpitch = f.pitch - base.pitch;
        const dNose = f.noseDx - base.noseDx, dNoseY = f.noseDy - base.noseDy;
        updateCal(cal, dyaw, dpitch, dNose, dNoseY);

        const nx = dyaw / T.MOTION_YAW_DEG, ny = dpitch / T.MOTION_PITCH_DEG, m = Math.hypot(nx, ny);
        if (m >= T.MOTION_MARGIN) {
          const bin = binOf(nx, ny);
          const cur = best.get(bin);
          if (!cur || m > cur.m) {
            cur?.bitmap.then((b) => b.close());
            best.set(bin, { m, t, bitmap: f.snapshot() });
          }
        }
        ui.ring(litSegments(best.keys(), cal));
        if (best.size > 0) ui.guide({ ok: false, code: 'keep_going' });

        const times = [...best.values()].map((v) => v.t);
        const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
        if (best.size >= T.MOTION_MIN_BINS && span >= T.MOTION_MIN_SPAN_MS) return { done: true };
      }, T.MOTION_TIMEOUT_MS);

      if (!r.timeout) {
        const picked = [...best.values()].sort((a, b) => a.t - b.t);
        const entries = await Promise.all(picked.map(async (v) => ({ t: v.t, bitmap: await v.bitmap })));
        ui.guide({ ok: false, code: '' });
        ui.phase('return');            // the ring stays lit: "Great! Now look straight again"
        await sleep(700);
        if (aborted) { entries.forEach((e) => e.bitmap.close()); throw new FlowError('aborted'); }
        return encode(entries, 'CHALLENGE');
      }
      best.forEach((v) => v.bitmap.then((b) => b.close()));
      if (state.restarts >= T.MAX_RESTARTS) throw new FlowError('challenge_timeout');
      state.restarts++;
      ui.guide({ ok: false, code: '' });
      ui.ring(new Set());
      ui.phase('retry');
      await sleep(1500);
    }
  }

  async function returnStage(base) {
    const opts = { maxBlink: base.blink + T.RETURN_BLINK_MARGIN };
    let since = null;
    const r = await stage((f, t) => {
      const g = f.n === 1 ? guidance(f, opts) : f.guide;
      ui.guide(g);
      if (!g.ok) { since = null; return; }
      since ??= t;
      if (t - since >= T.RETURN_STEADY_MS) return { ok: true };
    }, T.RETURN_TIMEOUT_MS);
    if (r.timeout) throw new FlowError('return_timeout');
    const entries = await collectSpaced(T.RETURN_FRAMES, T.RETURN_GAP_MS, false);
    if (!entries) throw new FlowError('return_timeout');
    return encode(entries, 'RETURN');
  }

  // ---- Public API ----------------------------------------------------------------------------------------
  function setView(v) { ({ video, stageEl, ui } = v); }

  // Resolves with the frames to upload, or throws FlowError (timeouts, or 'aborted').
  async function run() {
    aborted = false;
    sessionStart = performance.now();
    startLoop();
    const state = { restarts: 0, promptTs: 0 };
    try {
      const neutral = await neutralStage();
      const chal = await motionStage(neutral.base, state);
      const ret = await returnStage(neutral.base);
      return { frames: [...neutral.frames, ...chal, ...ret], promptTs: state.promptTs, restarts: state.restarts };
    } finally {
      stopLoop();
    }
  }

  function abort() {
    aborted = true;
    const cancel = cancelStage;
    stopLoop();
    cancel?.();
  }

  function dispose() {
    abort();
    landmarker?.close?.();
    landmarker = null;
  }

  return { ensureLandmarker, setView, run, abort, dispose };
}
