// Opens the camera and makes sure it is closed again. Every stream is tracked, so releaseAll() can be
// called from any exit path (back, close, rotate, tab hidden, page closed, error) and is idempotent.

export const CAMERA_CONSTRAINTS = {
  video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
};

// kind: 'denied' | 'missing' | 'busy' | 'unsupported' | 'cancelled' | 'unknown'
export class CameraError extends Error {
  constructor(kind, cause) { super(kind); this.kind = kind; this.cause = cause; }
}

export function classifyCameraError(e) {
  switch (e?.name) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError': return 'denied';
    case 'NotFoundError': case 'OverconstrainedError': case 'DevicesNotFoundError': return 'missing';
    case 'NotReadableError': case 'AbortError': case 'TrackStartError': return 'busy';
    default: return 'unknown';
  }
}

export function createCamera({ mediaDevices = globalThis.navigator?.mediaDevices } = {}) {
  const active = new Set();
  let generation = 0;   // bumped by releaseAll(): an open() still waiting on the permission prompt must not leak its stream

  function stop(stream) {
    if (!active.delete(stream)) return;
    for (const track of stream.getTracks()) track.stop();
  }

  async function open() {
    if (typeof mediaDevices?.getUserMedia !== 'function') throw new CameraError('unsupported');
    releaseAll();
    const mine = generation;
    let stream;
    try {
      stream = await mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (e) {
      throw new CameraError(classifyCameraError(e), e);
    }
    active.add(stream);
    if (mine !== generation) { stop(stream); throw new CameraError('cancelled'); }
    return { stream, release: () => stop(stream) };
  }

  function releaseAll() {
    generation++;
    for (const s of [...active]) stop(s);
  }

  return { open, releaseAll, get activeCount() { return active.size; } };
}

// Plays the stream in a <video> and resolves once frames are flowing.
export async function attachStream(video, stream) {
  video.srcObject = stream;
  if (video.readyState < 1) await new Promise((r) => { video.onloadedmetadata = r; });
  await video.play?.().catch(() => {});
}

// Leaving the page (or hiding the tab) always closes the camera. `onHidden` lets the app cancel its flow.
export function bindPageLifecycle(win, camera, { onHidden } = {}) {
  const hide = () => { camera.releaseAll(); onHidden?.(); };
  const onVisibility = () => { if (win.document.visibilityState === 'hidden') hide(); };
  win.addEventListener('pagehide', hide);
  win.document.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('pagehide', hide);
    win.document.removeEventListener('visibilitychange', onVisibility);
  };
}
