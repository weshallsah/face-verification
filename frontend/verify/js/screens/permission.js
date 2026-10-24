import { h } from '../dom.js';
import { S, fmt } from '../strings.js';
import { icon } from '../icons.js';
import { screenShell } from '../components/screen.js';
import { button, backButton } from '../components/buttons.js';
import { numberedStep } from '../components/cards.js';

// Step 1: explain why, before the browser asks. The browser prompt only appears when "Allow camera" is pressed.
export function permissionScreen({ onBack, onAllow }) {
  const P = S.permission;
  return screenShell({
    label: P.title,
    body: [
      backButton(S.common.back, onBack),
      h('div', { class: 'round-icon' }, icon('camera', 52, 1.8)),
      h('div', { class: 'perm-card' },
        h('h1', { id: 'screen-title' }, P.title),
        P.points.map((p) => h('div', { class: 'perm-point' }, h('span', { class: 'mini-ok', 'aria-hidden': 'true' }, icon('check', 14, 3)), h('span', null, p))),
        h('p', { class: 'perm-note' }, P.note)),
    ],
    foot: button({ label: P.allow, onClick: onAllow }),
  });
}

// The camera was refused: how to turn it back on, in the browser and in the app.
export function deniedScreen({ appName, onBack, onRetry }) {
  const D = S.denied;
  const group = (title, steps) => h('div', { class: 'how-card' }, h('span', { class: 'how-title' }, title), steps.map((s, i) => numberedStep(i + 1, fmt(s, { appName }), true)));
  return screenShell({
    label: D.title,
    body: [
      backButton(S.common.back, onBack),
      h('div', { class: 'stack centered' },
        h('div', { class: 'round-icon amber' }, icon('cameraOff', 44, 1.9)),
        h('h1', { class: 'title title-sm', id: 'screen-title' }, D.title),
        h('p', { class: 'lead' }, D.text)),
      h('div', { class: 'stack', style: 'margin-top:24px' }, group(D.browserTitle, D.browserSteps), group(D.appTitle, D.appSteps)),
    ],
    foot: button({ label: D.retry, onClick: onRetry }),
  });
}
