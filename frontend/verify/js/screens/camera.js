import { h } from '../dom.js';
import { S } from '../strings.js';
import { icon } from '../icons.js';
import { createOvalFrame } from '../components/oval-frame.js';
import { createPill } from '../components/pill.js';
import { createSteps } from '../components/steps.js';
import { createDebouncer } from '../debounce.js';
import { describe, stepOf } from '../guidance.js';

const HOLD_MS = 300;   // a live message must stay the same for this long before it replaces the one on screen

// The camera screen. `view` is what flow.js uses; `captureUi` is what capture.js drives.
// scene: optional element shown instead of the camera (dev preview only).
export function createCameraScreen({ onClose, scene = null }) {
  const video = h('video', { class: 'cam-video', autoplay: true, playsinline: true, muted: true, 'aria-hidden': 'true' });
  video.muted = true;   // the attribute alone is not enough on some browsers
  const freezeCanvas = h('canvas', { class: 'cam-freeze', hidden: true, 'aria-hidden': 'true' });
  const frame = createOvalFrame(scene ? [scene, freezeCanvas] : [video, freezeCanvas]);
  const pill = createPill();
  const steps = createSteps();
  const closeBtn = h('button', { type: 'button', class: 'cam-close', 'aria-label': S.camera.close, onclick: onClose }, icon('close', 20, 2.4));
  const el = h('main', { class: 'cam fx-screen', tabindex: '-1', 'aria-label': S.camera.status },
    h('div', { class: 'cam-top' }, closeBtn, steps.el, h('span', { class: 'cam-top-spacer' })),
    frame.el,
    pill.el,
    h('div', { class: 'cam-hint' }, icon('lock', 14, 2.2), h('span', null, S.camera.hint)));
  if (lowEndDevice()) el.classList.add('lite');

  let phase = 'neutral';
  let described = new Map();
  const debounce = createDebouncer(HOLD_MS);

  function render(d) {
    pill.set(S.camera.msg[d.key], d.tone);
    frame.ring.setState(d.ring);
    steps.set(stepOf(phase));
  }
  function setPhase(p) {
    phase = p;
    const d = describe(p, '');
    described = new Map([[d.key, d]]);
    debounce.force(d.key);
    render(d);
  }
  setPhase('neutral');

  // Driven by capture.js.
  const captureUi = {
    phase(p) {
      setPhase(p);
      if (p === 'neutral') frame.ring.setFilled([]);
    },
    // g = { ok, code }. Changes are debounced so the message never flickers.
    guide(g) {
      const d = describe(phase, g.ok ? 'ok' : g.code);
      described.set(d.key, d);
      render(described.get(debounce.push(d.key, performance.now())));
    },
    ring(segments) { frame.ring.setFilled(segments ?? []); },
  };

  const view = {
    video,
    stageEl: frame.el,
    captureUi,
    // Keep the last camera frame on screen after the camera is closed (drawn locally, never uploaded).
    freeze() {
      try {
        if (video.videoWidth) {
          freezeCanvas.width = video.videoWidth;
          freezeCanvas.height = video.videoHeight;
          freezeCanvas.getContext('2d').drawImage(video, 0, 0);
          freezeCanvas.hidden = false;
          video.hidden = true;
        }
      } catch { /* a dark background is fine */ }
    },
    captured() {
      setPhase('captured');
      frame.ring.setFilled([0, 1, 2, 3, 4, 5, 6, 7]);
      frame.setCaptured(true);
    },
    // Dev preview: show a phase + guidance code at once (no debounce).
    show(p, code = '') {
      setPhase(p);
      const d = describe(p, code);
      debounce.force(d.key);
      render(d);
      frame.setCaptured(p === 'captured');
    },
    frame,
    layout: frame.layout,
  };

  return { el, view, destroy() { frame.destroy(); } };
}

// Few cores or little memory: skip the live blur, it costs frames on cheap phones.
function lowEndDevice() {
  const n = globalThis.navigator ?? {};
  return (n.deviceMemory && n.deviceMemory <= 2) || (n.hardwareConcurrency && n.hardwareConcurrency <= 4);
}
