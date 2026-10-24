import { S } from '../strings.js';
import { resultTemplate } from '../components/screen.js';

// Screens the design export does not have, built from the result template in the same style.
// kind: 'unsupported' | 'noCamera' | 'cameraBusy' | 'cameraFailed' | 'loadFailed' | 'rotate'
const LOOK = {
  unsupported: { tone: 'neutral', icon: 'browserOff' },
  noCamera: { tone: 'warn', icon: 'cameraOff' },
  cameraBusy: { tone: 'warn', icon: 'camera' },
  cameraFailed: { tone: 'warn', icon: 'camera' },
  loadFailed: { tone: 'neutral', icon: 'cloudOff' },
  rotate: { tone: 'neutral', icon: 'rotate' },
};

export function stateScreen(kind, { onPrimary, insecure = false } = {}) {
  const copy = S.states[kind];
  const look = LOOK[kind];
  return resultTemplate({
    tone: look.tone,
    iconName: look.icon,
    title: copy.title,
    text: insecure && copy.insecure ? copy.insecure : copy.text,
    primary: copy.primary && onPrimary ? { label: copy.primary, onClick: onPrimary } : null,
  });
}
