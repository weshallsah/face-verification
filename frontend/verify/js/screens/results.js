import { h } from '../dom.js';
import { S } from '../strings.js';
import { resultTemplate } from '../components/screen.js';

// How each verdict.js id looks and what its buttons do. Text lives in strings.en.js (S.result / S.tips).
// act: continue | login | appeal | retry | tips (wired in main.js)
const LOOK = {
  verified: { tone: 'ok', icon: 'check', primary: 'continue' },
  already: { tone: 'ok', icon: 'shieldCheck', primary: 'continue' },
  duplicate: { tone: 'warn', icon: 'user', primary: 'login', secondary: 'appeal' },
  review: { tone: 'warn', icon: 'clock', primary: 'continue' },
  notLive: { tone: 'bad', icon: 'faceOff', primary: 'retry' },
  limit: { tone: 'neutral', icon: 'timer', primary: 'retry' },
  connection: { tone: 'neutral', icon: 'cloudOff', primary: 'retry' },
};
const RETRY_LOOK = { tone: 'warn', icon: 'retry', primary: 'retry', secondary: 'tips' };

export const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

// outcome: { id, tip?, retryAfterSec? } from verdict.js. act: { continue, login, appeal, retry, tips }
export function resultScreen(outcome, act, { now = () => Date.now() } = {}) {
  const R = S.result;
  const isRetry = outcome.id.startsWith('retry.');
  const look = isRetry ? RETRY_LOOK : (LOOK[outcome.id] ?? LOOK.connection);
  const copy = R[outcome.id] ?? R.connection;

  let text = copy.text;
  let countdown = null;
  let primaryDisabled = false;
  let timer = null;
  let primaryBtn = null;

  if (isRetry) text = copy.text ?? R.retryText;
  const labels = {
    continue: copy.primary, login: copy.primary, retry: isRetry ? R.retryPrimary : copy.primary,
    appeal: copy.secondary, tips: R.retrySecondary,
  };

  if (outcome.id === 'limit') {
    const total = Math.max(1, outcome.retryAfterSec);
    const until = now() + total * 1000;
    const left = () => Math.max(0, Math.ceil((until - now()) / 1000));
    text = copy.text(Math.max(1, Math.ceil(total / 60)));
    const value = h('span', { class: 'countdown-value' }, mmss(left()));
    countdown = h('div', { class: 'countdown', role: 'timer', 'aria-live': 'off' }, value, h('span', { class: 'countdown-label' }, copy.countdownLabel));
    primaryDisabled = true;
    timer = setInterval(() => {
      const l = left();
      value.textContent = mmss(l);
      if (l === 0) { clearInterval(timer); timer = null; if (primaryBtn) primaryBtn.disabled = false; }
    }, 1000);
  }

  const tipKey = outcome.tip ?? copy.tip;
  const el = resultTemplate({
    tone: look.tone,
    iconName: look.icon,
    title: copy.title,
    text,
    tip: isRetry ? S.tips[tipKey] : null,
    countdown,
    primary: { label: labels[look.primary], onClick: () => act[look.primary](outcome), disabled: primaryDisabled },
    secondary: look.secondary ? { label: labels[look.secondary], onClick: () => act[look.secondary](outcome) } : null,
  });
  primaryBtn = el.querySelector('.foot .btn-primary');
  return { el, destroy() { if (timer) clearInterval(timer); } };
}
