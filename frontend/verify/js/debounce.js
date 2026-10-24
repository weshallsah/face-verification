// Keeps the on-screen message steady. A new value is shown only after it has been the latest value
// for `holdMs` without interruption; flipping back to the shown value cancels the change. The first
// value is shown at once. `force` is for phase changes, which must not wait.
export function createDebouncer(holdMs = 300) {
  let shown;
  let candidate;
  let since = 0;
  return {
    push(value, t) {
      if (shown === undefined) { shown = value; return shown; }
      if (value === shown) { candidate = undefined; return shown; }
      if (value !== candidate) { candidate = value; since = t; }
      if (t - since >= holdMs) { shown = value; candidate = undefined; }
      return shown;
    },
    force(value) { shown = value; candidate = undefined; return shown; },
    get value() { return shown; },
  };
}
