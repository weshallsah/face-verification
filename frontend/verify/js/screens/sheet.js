import { h } from '../dom.js';
import { S } from '../strings.js';
import { button } from '../components/buttons.js';

// Privacy summary as a bottom sheet (card on desktop). Esc and a tap outside close it; focus is kept
// inside while it is open and returned to the opener afterwards.
export function openPrivacySheet({ privacyUrl, parent = document.body }) {
  const P = S.privacy;
  const opener = document.activeElement;
  const closeBtn = button({ label: P.close, onClick: close });
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('span', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('h2', { id: 'sheet-title' }, P.title),
    h('p', null, P.body),
    privacyUrl ? h('p', null, h('a', { href: privacyUrl, target: '_blank', rel: 'noopener noreferrer' }, P.fullPolicy)) : null,
    closeBtn);
  const overlay = h('div', { class: 'sheet-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, box);

  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('a[href], button')];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    opener?.focus?.();
  }
  document.addEventListener('keydown', onKey);
  parent.append(overlay);
  closeBtn.focus();
  return { close };
}
