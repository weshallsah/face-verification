// Loads the Lottie player once, on first use. It is the SVG-only "light" build of lottie-web 5.12.2,
// served from /vendor like MediaPipe; it is a classic script that sets window.lottie.
export const LOTTIE_URL = '/vendor/lottie/lottie_light.min.js';

let player;
export function loadLottie(src = LOTTIE_URL) {
  player ??= new Promise((resolve, reject) => {
    if (globalThis.lottie) return resolve(globalThis.lottie);
    const s = Object.assign(document.createElement('script'), { src, async: true });
    s.onload = () => (globalThis.lottie ? resolve(globalThis.lottie) : reject(new Error('lottie_missing')));
    s.onerror = () => { player = null; s.remove(); reject(new Error('lottie_load_failed')); };   // allow a later retry
    document.head.append(s);
  });
  return player;
}
