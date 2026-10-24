// The JWT lives in memory only. For WebView use the host passes it in the URL fragment
// (/verify#token=...); the fragment is never sent to a server, and it is removed from the address
// bar straight away. A ?token= query parameter is NOT accepted (it would end up in server logs and
// referrers); it is scrubbed from the URL and ignored.

let token = null;

export function initAuth({ location = window.location, history = window.history } = {}) {
  const frag = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const fromFragment = frag.get('token');
  if (fromFragment) token = fromFragment;

  if (fromFragment || query.has('token')) {
    frag.delete('token');
    query.delete('token');
    const q = query.toString(), f = frag.toString();
    history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + (f ? `#${f}` : ''));
  }
  return token !== null;
}

export const getToken = () => token;
export const setToken = (t) => { token = t; };   // dev-token fallback only
