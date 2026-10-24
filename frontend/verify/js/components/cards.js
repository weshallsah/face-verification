import { h } from '../dom.js';
import { icon, ART } from '../icons.js';
import { S } from '../strings.js';

// Privacy card: icon tile + title + one line.
export function privacyCard({ icon: name, title, text }) {
  return h('div', { class: 'card card-row' },
    h('div', { class: 'tile' }, icon(name, 24)),
    h('div', { class: 'card-text' }, h('span', { class: 'card-title' }, title), h('span', { class: 'card-sub' }, text)));
}

// Do / don't card: illustration, a check or cross badge, the text, and a visually hidden "Do" / "Don't",
// so the meaning never rests on the green or red tint alone.
export function doCard({ art, ok, label }) {
  return h('div', { class: 'card do-card' },
    h('div', { class: `do-art ${ok ? 'do' : 'dont'}` }, ART[art]()),
    h('div', { class: 'do-label' },
      h('span', { class: `badge ${ok ? 'badge-ok' : 'badge-no'}`, 'aria-hidden': 'true' }, icon(ok ? 'check' : 'cross', 14, 3.2)),
      h('span', null, h('span', { class: 'sr-only' }, `${ok ? S.tutorial.okLabel : S.tutorial.noLabel}: `), label)));
}

// Tip card: amber bulb + "Tip" + text.
export function tipCard(text, { accent = false } = {}) {
  return h('div', { class: `tip-card${accent ? ' tip-accent' : ''}` },
    icon(accent ? 'info' : 'bulb', 22),
    h('div', { class: 'card-text' }, accent ? null : h('span', { class: 'tip-title' }, S.common.tip), h('span', { class: 'tip-text' }, text)));
}

export function numberedStep(n, text, small = false) {
  return h('div', { class: 'num-step' }, h('span', { class: small ? 'num num-sm' : 'num' }, String(n)), h('span', null, text));
}
