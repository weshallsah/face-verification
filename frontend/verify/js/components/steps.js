import { h } from '../dom.js';
import { S } from '../strings.js';

// "Step 1 of 3 · Position": three bars plus the text, so the step never depends on colour.
export function createSteps() {
  const bars = [0, 1, 2].map(() => h('span', { class: 'step-bar' }));
  const label = h('span', { class: 'step-label' });
  const el = h('div', { class: 'steps' }, h('div', { class: 'step-bars', 'aria-hidden': 'true' }, bars), label);
  return {
    el,
    set(index) {   // 0..2
      bars.forEach((b, k) => { b.classList.toggle('on', k <= index); b.classList.toggle('done', index === 2); });
      label.textContent = S.camera.stepLabel(index + 1);
    },
  };
}
