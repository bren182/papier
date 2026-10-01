/**
 * Failed-login throttle, in memory (one process, one box). After FREE failures a
 * key is locked for 2^(n-FREE) seconds, capped at MAX_LOCK_MS; a success clears it.
 */
const FREE = 5;
const MAX_LOCK_MS = 15 * 60_000;
const FORGET_MS = 24 * 3600_000;

export function loginThrottle() {
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
      if (f.n >= FREE) f.until = now + Math.min(MAX_LOCK_MS, 1000 * 2 ** (f.n - FREE));
      fails.set(key, f);
    },
    succeed(key: string) {
      fails.delete(key);
    },
  };
}
