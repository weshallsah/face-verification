import { h } from '../dom.js';
import { S } from '../strings.js';
import { heroHeart, inlineHeart } from '../icons.js';
import { screenShell } from '../components/screen.js';
import { button } from '../components/buttons.js';
import { privacyCard } from '../components/cards.js';

export function welcomeScreen({ onStart, onPrivacy }) {
  const W = S.welcome;
  return screenShell({
    label: W.title,
    body: [
      h('div', { class: 'stack centered' },
        h('div', { class: 'hero' }, heroHeart(W.heroLabel)),
        h('h1', { class: 'title', id: 'screen-title' }, W.title, inlineHeart()),
        h('p', { class: 'lead' }, W.sub)),
      h('div', { class: 'stack', style: 'margin-top:28px' }, W.cards.map(privacyCard)),
      h('div', { style: 'display:flex;justify-content:center;margin-top:18px' }, button({ kind: 'link', label: W.privacyLink, onClick: onPrivacy })),
    ],
    foot: button({ label: W.start, onClick: onStart }),
  });
}
