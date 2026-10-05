/**
 * In-memory exponential-backoff throttle (one process, one box). After `free`
 * failures a key is locked for 2^(n-free) seconds, capped at `maxLockMs`; a
 * success clears it.
 */
const FORGET_MS = 24 * 3600_000;

export function loginThrottle({ free = 5, maxLockMs = 15 * 60_000 } = {}) {
  const fails = new Map<string, { n: number; until: number; last: number }>();
  return {
    /** Milliseconds until `key` may try again (0 = now). */
    wait(key: string, now = Date.now()) {
      const f = fails.get(key);
      return f ? Math.max(0, f.until - now) : 0;
    },
    fail(key: string, now = Date.now()) {
      if (fails.size > 10_000) for (const [k, f] of fails) if (now - f.last > FORGET_MS) fails.delete(k);
      const f = fails.get(key) ?? { n: 0, until: 0, last: now };
      f.n++;
      f.last = now;
      if (f.n >= free) f.until = now + Math.min(maxLockMs, 1000 * 2 ** (f.n - free));
      fails.set(key, f);
    },
    succeed(key: string) {
      fails.delete(key);
    },
  };
}
