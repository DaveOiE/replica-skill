/** Fixed-window limiter. hit(key) returns true when the call is allowed. `now` is injectable for tests. */
const MAX_KEYS = 5000;
export function makeLimiter({ max, windowMs, now = () => Date.now() }) {
  const seen = new Map();
  return {
    hit(key) {
      const t = now();
      if (seen.size > MAX_KEYS) for (const [k, v] of seen) if (v.reset <= t) seen.delete(k);   // forget finished windows so the map cannot grow for ever
      const e = seen.get(key);
      if (!e || e.reset <= t) { seen.set(key, { count: 1, reset: t + windowMs }); return true; }
      e.count += 1;
      return e.count <= max;
    },
    size: () => seen.size,
  };
}
