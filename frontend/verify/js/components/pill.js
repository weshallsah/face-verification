import { h } from '../dom.js';
import { icon } from '../icons.js';

// The instruction pill. The wrapper is a persistent aria-live="polite" region; changing the message swaps
// the pill inside it (a 180 ms fade, see .fx-msg), so a screen reader announces each new message once.
// The tone is shown with an icon as well as colour: dot (neutral), alert (fix something), check (done).
export function createPill() {
  const el = h('div', { class: 'pill-wrap', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  let last = null;
  return {
    el,
    set(text, tone = 'n') {
      if (last === `${tone}|${text}`) return;
      last = `${tone}|${text}`;
      const mark = tone === 'bad' ? icon('alert', 18, 2.4) : tone === 'ok' ? icon('check', 18, 3) : h('span', { class: 'pill-dot' });
      el.replaceChildren(h('div', { class: `pill pill-${tone} fx-msg` }, h('span', { class: 'pill-mark', 'aria-hidden': 'true' }, mark), h('span', null, text)));
    },
  };
}
