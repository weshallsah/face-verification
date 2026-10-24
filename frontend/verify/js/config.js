const DEFAULTS = {
  appName: 'our app', loginUrl: '/login', supportUrl: '', privacyUrl: '', returnUrlAllowlist: [], devMode: false,
};

export async function loadConfig(fetchFn = fetch) {
  try {
    const res = await fetchFn('/verify/config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return { ...DEFAULTS, ...(await res.json()) };
  } catch {
    return DEFAULTS;   // the page still works; only the configurable links are missing
  }
}

// ?returnUrl=... is only honoured when its ORIGIN is in the allowlist (exact match), it is https
// (http only for localhost in dev) and it carries no credentials. Anything else is ignored.
export function parseReturnUrl(search, allowlist = [], devMode = false) {
  const raw = new URLSearchParams(search).get('returnUrl');
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  const local = devMode && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !local) return null;
  const listed = allowlist.some((o) => { try { return new URL(o).origin === url.origin; } catch { return false; } });
  return listed ? url.toString() : null;
}
