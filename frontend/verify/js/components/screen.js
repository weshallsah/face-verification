import { h } from '../dom.js';
import { icon } from '../icons.js';
import { tipCard } from './cards.js';
import { button } from './buttons.js';

// Page frame shared by every non-camera screen: a scrolling body and a footer pinned above the home bar.
export function screenShell({ body, foot, center = false, className = '', label }) {
  return h('main', { class: `screen fx-screen ${className}`, tabindex: '-1', 'aria-label': label },
    h('div', { class: 'panel' },
      h('div', { class: `body${center ? ' body-center' : ''}` }, body),
      foot ? h('div', { class: 'foot' }, foot) : null));
}

// Result screen template: icon in a tinted circle, title, one line, optional tip and countdown,
// actions at the bottom. tone: 'ok' | 'warn' | 'bad' | 'neutral'. `countdown` is an element (see result-screens.js).
export function resultTemplate({ tone, iconName, title, text, tip, countdown, primary, secondary, spinner = false }) {
  return screenShell({
    center: true,
    className: `result result-${tone}`,
    body: [
      h('div', { class: 'result-icon' }, icon(iconName, 50, 2)),
      h('h1', { class: 'result-title', id: 'screen-title' }, title),
      text ? h('p', { class: 'result-text' }, text) : null,
      tip ? tipCard(tip) : null,
      countdown ?? null,
    ],
    foot: primary || secondary ? [primary && button({ kind: 'primary', ...primary }), secondary && button({ kind: 'secondary', ...secondary })] : null,
  });
}
