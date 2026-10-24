// reason: neutral_timeout | challenge_timeout | return_timeout (shown as a retry screen), aborted (cancelled by us)
export class FlowError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
