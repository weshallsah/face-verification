// Orchestrates one verification attempt: camera + model + session -> capture -> upload -> result.
// Everything it touches is injected, so the exit paths (and that the camera is closed on each of them)
// are unit tested without a browser.
//
// The camera is released: the moment capture finishes (before the upload), on every error, on cancel(),
// and, as a last resort, in the `finally` of start().

import { FlowError } from './errors.js';
import { attachStream } from './camera-session.js';
import { consumesSession, resolveClientFailure, resolveVerdict } from './verdict.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SILENT_RETRIES = 2;   // expired sessions (410) are replaced without telling the user, but not forever

export function buildForm(session, out) {
  const form = new FormData();
  form.append('sessionId', session.sessionId);
  form.append('meta', JSON.stringify(out.frames.map((f) => ({ phase: f.phase, ts: f.ts }))));
  form.append('promptTs', String(out.promptTs));
  form.append('restarts', String(out.restarts));
  out.frames.forEach((f, i) => form.append('frames', f.blob, `f${i}.jpg`));
  return form;
}

export function createFlow({
  camera, capture, sessions, api, ui,
  attach = attachStream, makeForm = buildForm, delay = sleep, now = () => performance.now(),
  minProcessingMs = 1500,   // the processing screen never flashes past
  capturedMs = 900,         // full green ring + check, before the processing screen
}) {
  let running = false;
  let cancelled = false;
  let uploading = false;           // from the moment frames are sent: the attempt is counted, so it must not be interrupted
  let chain = Promise.resolve();   // runs are queued, so start() right after cancel() waits for the old run to unwind
  let pending = 0;

  async function attempt() {
    ui.starting();
    // allSettled, not all: if one part fails the camera may still arrive and must be closed.
    const [camR, modelR, sessR] = await Promise.allSettled([camera.open(), capture.ensureLandmarker(), sessions.acquire()]);
    const cam = camR.status === 'fulfilled' ? camR.value : null;
    if (cancelled) { cam?.release(); return 'stopped'; }

    if (!cam) {
      ui.cameraProblem(camR.reason?.kind ?? 'unknown');
      return 'stopped';
    }
    if (modelR.status === 'rejected') {
      console.error(modelR.reason);
      cam.release();
      ui.loadFailed();
      return 'stopped';
    }
    if (sessR.status === 'rejected' || !sessR.value.ok) {
      cam.release();
      ui.result(resolveVerdict(sessR.status === 'rejected' ? { error: 'network' } : sessR.value.result));
      return 'stopped';
    }
    const { session } = sessR.value;

    const view = ui.cameraScreen();
    await attach(view.video, cam.stream);
    if (cancelled) return 'stopped';
    capture.setView({ video: view.video, stageEl: view.stageEl, ui: view.captureUi });

    let out;
    try {
      out = await capture.run();
    } catch (e) {
      cam.release();
      if (cancelled) return 'stopped';
      ui.result(e instanceof FlowError ? resolveClientFailure(e.reason) : { id: 'retry.generic' });
      return 'stopped';
    }
    if (cancelled) return 'stopped';

    // Capture is done: keep the last frame on screen, then close the camera before anything else happens.
    view.freeze();
    cam.release();
    view.captured();
    uploading = true;
    const upload = api.verify(makeForm(session, out));
    await delay(capturedMs);
    if (cancelled) return 'stopped';

    ui.processing();
    const shownAt = now();
    const res = await upload;
    if (cancelled) return 'stopped';
    if (consumesSession(res)) sessions.invalidate();
    const outcome = resolveVerdict(res);
    const rest = minProcessingMs - (now() - shownAt);
    if (rest > 0) await delay(rest);
    if (cancelled) return 'stopped';

    if (outcome.id === 'sessionExpired') return 'again';
    ui.result(outcome);
    return 'stopped';
  }

  function start() {
    if (pending > 0 && !cancelled) return chain;   // already running
    pending++;
    chain = chain.then(run).finally(() => { pending--; });
    return chain;
  }

  async function run() {
    running = true;
    cancelled = false;
    try {
      for (let silent = 0; ; silent++) {
        if ((await attempt()) !== 'again') break;
        if (silent >= MAX_SILENT_RETRIES) { ui.result({ id: 'connection' }); break; }
        sessions.invalidate();
      }
    } catch (e) {
      console.error(e);
      if (!cancelled) ui.result({ id: 'connection' });
    } finally {
      camera.releaseAll();
      capture.abort();
      running = false;
      uploading = false;
    }
  }

  // Leave the camera flow now (close button, rotate, tab hidden, page closing). The session is kept.
  function cancel() {
    cancelled = true;
    capture.abort();
    camera.releaseAll();
  }

  return {
    start,
    cancel,
    get running() { return running; },
    // true while capture / preparation can still be abandoned without losing a verdict
    get interruptible() { return running && !uploading; },
  };
}
