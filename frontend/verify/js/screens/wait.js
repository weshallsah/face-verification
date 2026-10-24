import { h } from '../dom.js';
import { S } from '../strings.js';
import { icon } from '../icons.js';
import { screenShell } from '../components/screen.js';
import { createRing, TICKS } from '../components/ring.js';

// A spinning tick ring around a breathing icon (the design's processing visual). kind: 'proc' (green) | 'wait' (accent)
function spinner(kind, iconName) {
  const ring = createRing({ rx: 72, ry: 72, offset: 0, tickW: 4, tickH: 14, state: kind, staggerMs: 0 });
  [...ring.el.children].forEach((t, i) => { t.style.opacity = (0.12 + 0.88 * (i / (TICKS - 1))).toFixed(2); });
  return h('div', { class: `spinner spinner-${kind}`, 'aria-hidden': 'true' },
    h('div', { class: 'ring-box' }, ring.el),
    h('div', { class: 'spinner-core' }, icon(iconName, 52, 1.8)));
}

// Processing: shown for at least `minMs` by flow.js. The subtext rotates through the design's lines.
export function processingScreen() {
  const P = S.processing;
  const line = h('div', { class: 'proc-line', role: 'status', 'aria-live': 'polite' });
  let i = 0;
  const show = () => line.replaceChildren(h('span', { class: 'fx-msg', style: 'display:inline-block' }, P.lines[i++ % P.lines.length]));
  show();
  const timer = setInterval(show, 1300);
  const el = screenShell({
    center: true,
    label: P.title,
    body: [
      spinner('proc', 'faceScan'),
      h('div', { class: 'stack centered', style: 'gap:10px' }, h('h1', { class: 'title', id: 'screen-title' }, P.title), line),
      h('p', { class: 'proc-keep' }, P.keepOpen),
    ],
  });
  return { el, destroy() { clearInterval(timer); } };
}

// Shown while the camera, the model and the session are being prepared.
export function startingScreen() {
  return screenShell({
    center: true,
    label: S.starting.title,
    body: [
      spinner('wait', 'camera'),
      h('h1', { class: 'title title-sm', id: 'screen-title', role: 'status' }, S.starting.title),
      h('p', { class: 'lead' }, S.starting.text),
    ],
  });
}
