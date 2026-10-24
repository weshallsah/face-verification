import { h } from '../dom.js';

// 8-segment tick ring: 48 ticks, 6 per segment. Segment i spans [45 i, 45 (i + 1)) degrees clockwise
// from the top (see ring-map.js). Tick geometry is the design's makeTicks(), with a configurable start
// angle: the camera ring starts at 0 (segment boundaries on the axes, like the server bins); the tutorial
// animation keeps the design's -22.5 (segments centred on the axes), as it is only an illustration.
export const TICKS = 48;
export const PER_SEGMENT = 6;

// Tick i: centre position and rotation on an ellipse of half-axes rx + offset, ry + offset around (0, 0).
export function tickGeometry(i, rx, ry, offset, startDeg = 0) {
  const a = rx + offset, b = ry + offset;
  const r = ((startDeg + 3.75 + 7.5 * i) * Math.PI) / 180;
  return {
    x: a * Math.sin(r),
    y: -b * Math.cos(r),
    rot: (Math.atan2(Math.sin(r) / a, Math.cos(r) / b) * 180) / Math.PI,
  };
}

// state: 'search' | 'problem' | 'hold' | 'move' | 'captured' (colours live in app.css, per data-state)
export function createRing({ rx, ry, offset = 16, startDeg = 0, tickW = 4, tickH = 14, state = 'search', staggerMs = 45, segClass = null } = {}) {
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const seg = Math.floor(i / PER_SEGMENT);
    return h('span', {
      class: `tick${segClass ? ` ${segClass(seg)}` : ''}`,
      style: `width:${tickW}px;height:${tickH}px;transition-delay:${(i % PER_SEGMENT) * staggerMs}ms`,
    });
  });
  const el = h('div', { class: 'ring', 'data-state': state, 'aria-hidden': 'true' }, ticks);
  let lit = new Set();

  function layout(nextRx, nextRy) {
    ticks.forEach((t, i) => {
      const g = tickGeometry(i, nextRx, nextRy, offset, startDeg);
      t.style.left = `${(g.x - tickW / 2).toFixed(1)}px`;
      t.style.top = `${(g.y - tickH / 2).toFixed(1)}px`;
      t.style.transform = `rotate(${g.rot.toFixed(1)}deg)`;
    });
  }
  if (rx != null) layout(rx, ry);

  return {
    el,
    layout,
    setState(s) { if (el.dataset.state !== s) el.dataset.state = s; },
    // Lights the given segments (green in the 'move' state). Only touches ticks that changed.
    setFilled(segments) {
      const next = new Set(segments ?? []);
      for (let seg = 0; seg < TICKS / PER_SEGMENT; seg++) {
        if (next.has(seg) === lit.has(seg)) continue;
        for (let k = 0; k < PER_SEGMENT; k++) ticks[seg * PER_SEGMENT + k].classList.toggle('on', next.has(seg));
      }
      lit = next;
    },
    get filled() { return lit; },
  };
}
