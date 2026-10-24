import { h } from '../dom.js';
import { icon } from '../icons.js';

// Real <button>s, at least 48 px tall, with a visible focus ring (see app.css).
// kind: 'primary' | 'secondary' | 'link'
export function button({ label, kind = 'primary', onClick, disabled = false, id }) {
  return h('button', { type: 'button', class: `btn btn-${kind}`, onclick: onClick, disabled, id }, label);
}

export function backButton(label, onClick) {
  return h('button', { type: 'button', class: 'btn-round', 'aria-label': label, onclick: onClick }, icon('back', 22, 2.2));
}
