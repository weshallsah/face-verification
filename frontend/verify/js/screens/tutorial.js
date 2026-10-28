import { h } from '../dom.js';
import { S } from '../strings.js';
import { icon, HEAD } from '../icons.js';
import { screenShell } from '../components/screen.js';
import { button, backButton } from '../components/buttons.js';
import { doCard, tipCard, numberedStep } from '../components/cards.js';
import { createRing } from '../components/ring.js';
import { loadLottie } from '../lottie.js';

export const TUTORIAL_ANIM_URL = '/verify/media/face-circle.json';
// Frames of the animation (60 fps, 420 frames): still until CIRCLE_START, the head circles while the
// ring fills until CIRCLE_END, then it looks straight again. STILL_FRAME is mid-circle, for reduced motion.
const CIRCLE_START = 30, CIRCLE_END = 366, STILL_FRAME = 200;

// Fallback demo (CSS only), used when the Lottie animation can't load: fit and hold still -> head moves
// in a circle, segments light -> look straight -> check. With reduced motion the head stays still.
function cssDemo() {
  const ring = createRing({ rx: 62, ry: 80, offset: 12, startDeg: -22.5, tickW: 3, tickH: 10, state: 'demo', staggerMs: 0, segClass: (s) => `ts${s}` });
  const caps = S.tutorial.demoCaptions;
  return h('div', { class: 'tut-demo', role: 'img', 'aria-label': S.tutorial.demoLabel },
    h('div', { class: 'tut-oval' }, h('div', { class: 'tut-head' }, HEAD(112, 146))),
    h('div', { class: 'ring-box' }, ring.el),
    h('div', { class: 'tut-check' }, icon('check', 20, 3)),
    h('div', { class: 'tut-caps', 'aria-hidden': 'true' }, caps.map((c, i) => h('span', { class: `cap${i + 1}` }, c))));
}

// The looping Lottie demo, with a caption that follows the animation. Returns { el, destroy }.
function lottieDemo() {
  const T = S.tutorial;
  const stage = h('div', { class: 'tut-anim' });
  const cap = h('p', { class: 'tut-cap', 'aria-hidden': 'true' });
  const el = h('div', { class: 'tut-demo tut-demo-lottie', role: 'img', 'aria-label': T.animLabel }, stage, cap);
  let anim, gone = false, phase = -1;
  const setPhase = (p) => {
    if (p === phase) return;
    phase = p;
    cap.replaceChildren(h('span', { class: 'fx-msg' }, T.animCaptions[p]));   // a new node replays the fade-in
  };
  setPhase(0);

  Promise.all([loadLottie(), fetch(TUTORIAL_ANIM_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`anim ${r.status}`))))])
    .then(([lottie, animationData]) => {
      if (gone) return;
      const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      anim = lottie.loadAnimation({ container: stage, renderer: 'svg', loop: true, autoplay: !still, animationData });
      if (still) { anim.goToAndStop(STILL_FRAME, true); setPhase(1); return; }
      anim.addEventListener('enterFrame', ({ currentTime: f }) => setPhase(f < CIRCLE_START ? 0 : f < CIRCLE_END ? 1 : 2));
    })
    .catch(() => { if (!gone) el.replaceWith(cssDemo()); });

  return { el, destroy() { gone = true; anim?.destroy(); } };
}

export function tutorialScreen({ onBack, onOpenCamera }) {
  const T = S.tutorial;
  const demo = lottieDemo();
  const el = screenShell({
    label: T.title,
    body: [
      h('div', { class: 'head-row' }, backButton(S.common.back, onBack), h('h1', { class: 'title title-sm', id: 'screen-title' }, T.title)),
      demo.el,
      h('ol', { class: 'steps-list', style: 'list-style:none;margin-bottom:0;padding:0' }, T.steps.map((s, i) => h('li', null, numberedStep(i + 1, s)))),
      h('h2', { class: 'sec-title' }, T.bestTitle),
      h('div', { class: 'do-grid' }, T.dos.map(doCard)),
      tipCard(T.note, { accent: true }),
    ],
    foot: button({ label: T.openCamera, onClick: onOpenCamera }),
  });
  return { el, destroy: demo.destroy };
}
