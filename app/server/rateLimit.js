/** Fixed-window limiter. hit(key) returns true when the call is allowed. `now` is injectable for tests. */
export function makeLimiter({ max, windowMs, now = () => Date.now() }) {
  const seen = new Map();
  return {
    hit(key) {
      const t = now();
      const e = seen.get(key);
      if (!e || e.reset <= t) { seen.set(key, { count: 1, reset: t + windowMs }); return true; }
      e.count += 1;
      return e.count <= max;
    },
  };
}
