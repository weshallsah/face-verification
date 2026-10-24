// Thin client for /v1/face. Never throws: failures come back as { error: 'network' | 'timeout' } so the
// caller can show the "connection problem" screen. Non-JSON bodies (express-rate-limit's own 429 is
// plain text) are tolerated.

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return undefined;
  if (/^\d+$/.test(String(value).trim())) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

export function createApi({ fetchFn = (...a) => fetch(...a), getToken, sessionTimeoutMs = 10000, verifyTimeoutMs = 30000 }) {
  async function call(path, init, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const token = await getToken();
      const res = await fetchFn(path, {
        ...init,
        cache: 'no-store',
        signal: ctrl.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({}));
      return { httpStatus: res.status, body, retryAfterSec: parseRetryAfter(res.headers?.get?.('Retry-After')) };
    } catch (e) {
      return { error: e?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    createSession: () => call('/v1/face/session', { method: 'POST' }, sessionTimeoutMs),
    verify: (form) => call('/v1/face/verify', { method: 'POST', body: form }, verifyTimeoutMs),
  };
}
