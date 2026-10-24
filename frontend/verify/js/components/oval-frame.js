import { h } from '../dom.js';
import { createRing } from './ring.js';
import { icon } from '../icons.js';

// Where the oval sits inside a camera frame of W x H px (portrait phone: design's 390x844 gives
// rx 128 / ry 160 at 45% of the height; landscape-ish desktop frame: the design's 680x440).
export function computeOval(W, H) {
  if (W > H) {
    const ry = H * 0.29;
    return { cx: W / 2, cy: H * 0.536, rx: ry * 0.78, ry };
  }
  const ry = Math.min(H * 0.19, W * 0.41);
  return { cx: W / 2, cy: H * 0.45, rx: ry * 0.8, ry };
}

// The camera frame: media (video / freeze frame / dev scene) with everything outside the oval dimmed and
// blurred, the oval outline, the tick ring, and the capture check. It re-lays-out whenever it is resized
// (rotation, browser bars, desktop resize).
export function createOvalFrame(media = []) {
  const ring = createRing({ offset: 18, tickW: 4, tickH: 14 });
  const dim = h('div', { class: 'cam-dim' });
  const outline = h('div', { class: 'cam-outline' });
  const ringBox = h('div', { class: 'ring-box' }, ring.el);
  const check = h('div', { class: 'cam-check', hidden: true }, icon('check', 28, 3));
  const el = h('div', { class: 'cam-frame' }, media, dim, outline, ringBox, check);

  function layout() {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const o = computeOval(W, H);
    el.style.setProperty('--cx', `${o.cx}px`);
    el.style.setProperty('--cy', `${o.cy}px`);
    el.style.setProperty('--rx', `${o.rx}px`);
    el.style.setProperty('--ry', `${o.ry}px`);
    check.style.top = `${o.cy - o.ry - 18 - 12 - 52}px`;
    ring.layout(o.rx, o.ry);
  }
  let observer = null;
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(layout); observer.observe(el); }

  return {
    el,
    ring,
    layout,
    setCaptured(on) {
      el.classList.toggle('captured', on);
      check.hidden = !on;
    },
    destroy() { observer?.disconnect(); },
  };
}
