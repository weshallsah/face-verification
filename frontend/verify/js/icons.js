import { svgEl } from './dom.js';

// Line icons: 24x24, stroke = currentColor. Inner markup only.
const CAM = '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>';
const FACE_FRAME = '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>';
const LINE = {
  camera: CAM,
  cameraOff: `${CAM}<path d="M3 3l18 18"/>`,
  shieldKey: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><circle cx="12" cy="11" r="2"/><path d="M12 13v3"/>',
  shieldCheck: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  retry: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  faceOff: `${FACE_FRAME}<path d="M9 9.5v1M15 9.5v1"/><path d="M9.5 15.5h5"/>`,
  faceScan: `${FACE_FRAME}<path d="M9 9.5v1M15 9.5v1"/><path d="M12 10v3h-1"/><path d="M9.5 15.5c1.4 1 3.6 1 5 0"/>`,
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4"/><path d="M9 2h6"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M7.5 7.6A5.5 5.5 0 0 0 7 18h10.5"/><path d="M20.6 15.7A4 4 0 0 0 17 10h-.6A5.5 5.5 0 0 0 10 6.3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  cross: '<path d="M7 7l10 10M17 7L7 17"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19L12 3.5z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  browserOff: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M9.5 12.5l5 3.5M14.5 12.5l-5 3.5"/>',
  rotate: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
};

// name, size in px, stroke width
export function icon(name, size = 24, stroke = 2) {
  return svgEl(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${LINE[name]}</svg>`);
}

// ---- Illustrations (flat, faceless-of-real-people, as in the design) --------------------------------------
const art = (markup) => () => svgEl(markup);

const BODY = '<path d="M14 80 C16 67 26 63 40 63 C54 63 64 67 66 80 Z" fill="#4C5A73"/>';
const HAIR = '<path d="M19 39 C18 22 28 14 40 14 C53 14 62 22 61 39 C56 29 49 25 40 25 C31 25 24 29 19 39 Z" fill="#33251E"/>';
const EYES = '<circle cx="32.5" cy="42" r="2.5" fill="#2A1E19"/><circle cx="47.5" cy="42" r="2.5" fill="#2A1E19"/>';
const SMILE = '<path d="M33 51 Q40 56 47 51" stroke="#8E4A3A" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
const small = (inner) => `<svg width="72" height="72" viewBox="0 0 80 80" aria-hidden="true" focusable="false">${inner}</svg>`;

export const ART = {
  goodLight: art(small(`<circle cx="66" cy="13" r="6" fill="#F5B400"/><path d="M66 2v3M66 21v3M55 13h3M74 13h3M58.5 5.5l2 2M71.5 18.5l2 2M73.5 5.5l-2 2M60.5 18.5l-2 2" stroke="#F5B400" stroke-width="2" stroke-linecap="round"/>${BODY}<circle cx="40" cy="40" r="21" fill="#E8B08C"/>${HAIR}${EYES}${SMILE}`)),
  badLight: art(small('<circle cx="40" cy="38" r="37" fill="#FFF1B8"/><circle cx="40" cy="38" r="28" fill="#FFFFFF"/><path d="M14 80 C16 67 26 63 40 63 C54 63 64 67 66 80 Z" fill="#2E3646"/><circle cx="40" cy="40" r="21" fill="#7E5C4A"/><path d="M19 39 C18 22 28 14 40 14 C53 14 62 22 61 39 C56 29 49 25 40 25 C31 25 24 29 19 39 Z" fill="#1E1612"/><circle cx="32.5" cy="42" r="2.5" fill="#3A2A22"/><circle cx="47.5" cy="42" r="2.5" fill="#3A2A22"/>')),
  fullFace: art(small(`${BODY}<circle cx="40" cy="40" r="21" fill="#DDA27F"/>${HAIR}${EYES}${SMILE}`)),
  covered: art(small(`${BODY}<circle cx="40" cy="40" r="21" fill="#DDA27F"/><path d="M18 35 C19 19 29 12 40 12 C52 12 61 19 62 35 Z" fill="#D9534F"/><path d="M40 33 H70 C69 37 66 39 62 39 H40 Z" fill="#B8423E"/><rect x="26" y="37" width="13" height="9" rx="4" fill="#14161B"/><rect x="41" y="37" width="13" height="9" rx="4" fill="#14161B"/><path d="M38 40 H42" stroke="#14161B" stroke-width="2"/><path d="M23 48 C30 46 50 46 57 48 L55 57 C48 64 32 64 25 57 Z" fill="#EEF2F8" stroke="#C3CCDA" stroke-width="1.2"/>`)),
  onlyYou: art(small(`${BODY}<circle cx="40" cy="40" r="21" fill="#DDA27F"/>${HAIR}${EYES}${SMILE}`)),
  otherPeople: art(small(`<g transform="translate(24 4) scale(0.72)"><path d="M14 80 C16 67 26 63 40 63 C54 63 64 67 66 80 Z" fill="#7A6A8E"/><circle cx="40" cy="40" r="21" fill="#B07A5A"/><path d="M19 39 C18 22 28 14 40 14 C53 14 62 22 61 39 C56 29 49 25 40 25 C31 25 24 29 19 39 Z" fill="#8A5A2B"/><circle cx="32.5" cy="42" r="2.5" fill="#2A1E19"/><circle cx="47.5" cy="42" r="2.5" fill="#2A1E19"/></g><g transform="translate(-8 2)">${BODY}<circle cx="40" cy="40" r="21" fill="#DDA27F"/>${HAIR}${EYES}${SMILE}</g>`)),
};

// The head used by the tutorial animation and the dev preview scene (200x260 design units).
export const HEAD = (w = 112, h = 146) => svgEl(`<svg width="${w}" height="${h}" viewBox="0 0 200 260" aria-hidden="true" focusable="false"><path d="M18 260 C 22 214 56 196 100 196 C 144 196 178 214 182 260 Z" fill="#4C5A73"/><rect x="84" y="160" width="32" height="44" rx="14" fill="#C98E6E"/><ellipse cx="40" cy="112" rx="9" ry="15" fill="#D29572"/><ellipse cx="160" cy="112" rx="9" ry="15" fill="#D29572"/><ellipse cx="100" cy="108" rx="60" ry="74" fill="#DDA27F"/><path d="M40 100 C 36 52 64 30 100 30 C 140 30 166 54 160 100 C 150 74 128 62 100 62 C 72 62 52 72 40 100 Z" fill="#33251E"/><ellipse cx="78" cy="112" rx="5" ry="6" fill="#2A1E19"/><ellipse cx="122" cy="112" rx="5" ry="6" fill="#2A1E19"/><path d="M100 116 Q 96 132 102 136" stroke="#B87A5C" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M84 150 Q 100 162 116 150" stroke="#8E4A3A" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`);

const HEART_PATH = 'M60 104 C 22 80 8 60 8 41 C 8 25 20 13 35 13 C 46 13 55 19 60 28 C 65 19 74 13 85 13 C 100 13 112 25 112 41 C 112 60 98 80 60 104 Z';

// The welcome illustration: a heart with a lock, and two sparkles.
export const heroHeart = (label) => svgEl(`<svg width="96" height="96" viewBox="0 0 120 120" role="img" aria-label="${label}"><path d="${HEART_PATH}" fill="var(--accent)"/><ellipse cx="34" cy="34" rx="12" ry="8" fill="#FFFFFF" opacity="0.35" transform="rotate(-30 34 34)"/><path d="M50 54 v-7 a10 10 0 0 1 20 0 v7" stroke="#FFFFFF" stroke-width="5.5" fill="none" stroke-linecap="round"/><rect x="44" y="52" width="32" height="26" rx="6" fill="#FFFFFF"/><circle cx="60" cy="63" r="3.6" fill="var(--accent)"/><rect x="58.2" y="64" width="3.6" height="7" rx="1.8" fill="var(--accent)"/><path d="M104 8 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 z" fill="#F5B400"/><path d="M14 92 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6 z" fill="#F5B400"/></svg>`);

// The small drawn heart that ends the welcome headline (replaces the typed emoji).
export const inlineHeart = () => svgEl(`<svg class="inline-heart" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><path d="${HEART_PATH}" fill="var(--accent)"/><ellipse cx="34" cy="34" rx="12" ry="8" fill="#FFFFFF" opacity="0.35" transform="rotate(-30 34 34)"/></svg>`);
