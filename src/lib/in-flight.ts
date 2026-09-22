// Until the session serializes commands itself: the adapter answers "busy" to
// a second in-flight command, so a call made while one is pending is skipped
// (resolves undefined) instead of reaching the adapter. One flag for the whole
// app, so a read the previous selection left pending still counts.
let pending = false;

export function inFlight<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T | undefined> {
  return async (...args) => {
    if (pending) return undefined;
    pending = true;
    try {
      return await fn(...args);
    } finally {
      pending = false;
    }
  };
}
