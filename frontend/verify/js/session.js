// Holds the current verification session so it can be reused. A session is only used up when the server
// gives a verdict (or says it is gone), so after rotating the phone, a client-side timeout or a lost
// connection the same one is reused and /session is not called again. It is reused only while it has
// more than `marginMs` left, so a capture cannot run past its expiry.
export function createSessions({ api, now = () => Date.now(), marginMs = 60000 }) {
  let current = null;
  return {
    async acquire() {
      if (current && now() < current.expiresAt - marginMs) return { ok: true, session: current, reused: true };
      current = null;
      const res = await api.createSession();
      const b = res.body;
      if (res.httpStatus === 200 && b?.sessionId && b.challenge === 'HEAD_MOTION') {
        current = { sessionId: b.sessionId, challenge: b.challenge, expiresAt: now() + (Number(b.expiresIn) || 300) * 1000 };
        return { ok: true, session: current, reused: false };
      }
      // Wrong challenge type or malformed answer: nothing we can run, show the generic problem screen.
      return { ok: false, result: res.httpStatus === 200 ? { httpStatus: 500, body: {} } : res };
    },
    invalidate() { current = null; },
    get current() { return current; },
  };
}
