import en from './strings.en.js';

// To add a language: import it here and add it to `locales` (e.g. import hi from './strings.hi.js').
const locales = { en };

export const S = locales[(globalThis.navigator?.language ?? 'en').slice(0, 2)] ?? en;

// "Find {appName} and open Permissions" -> fmt(text, { appName })
export const fmt = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
