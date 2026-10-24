import { h } from '../dom.js';
import { S } from '../strings.js';
import { icon, HEAD } from '../icons.js';
import { screenShell } from '../components/screen.js';
import { button, backButton } from '../components/buttons.js';
import { doCard, tipCard, numberedStep } from '../components/cards.js';
import { createRing } from '../components/ring.js';

// The looping demo (CSS only): fit and hold still -> head moves in a circle, segments light -> look
// straight -> check. With reduced motion the head stays still and the check fades.
function demo() {
  const ring = createRing({ rx: 62, ry: 80, offset: 12, startDeg: -22.5, tickW: 3, tickH: 10, state: 'demo', staggerMs: 0, segClass: (s) => `ts${s}` });
  const caps = S.tutorial.demoCaptions;
  return h('div', { class: 'tut-demo', role: 'img', 'aria-label': S.tutorial.demoLabel },
    h('div', { class: 'tut-oval' }, h('div', { class: 'tut-head' }, HEAD(112, 146))),
    h('div', { class: 'ring-box' }, ring.el),
    h('div', { class: 'tut-check' }, icon('check', 20, 3)),
    h('div', { class: 'tut-caps', 'aria-hidden': 'true' }, caps.map((c, i) => h('span', { class: `cap${i + 1}` }, c))));
}

export function tutorialScreen({ onBack, onOpenCamera }) {
  const T = S.tutorial;
  return screenShell({
    label: T.title,
    body: [
      h('div', { class: 'head-row' }, backButton(S.common.back, onBack), h('h1', { class: 'title title-sm', id: 'screen-title' }, T.title)),
      demo(),
      h('ol', { class: 'steps-list', style: 'list-style:none;margin-bottom:0;padding:0' }, T.steps.map((s, i) => h('li', null, numberedStep(i + 1, s)))),
      h('h2', { class: 'sec-title' }, T.bestTitle),
      h('div', { class: 'do-grid' }, T.dos.map(doCard)),
      tipCard(T.note, { accent: true }),
    ],
    foot: button({ label: T.openCamera, onClick: onOpenCamera }),
  });
}
