/**
 * Shared sliding-window attempt store used by the IP rate limiters
 * (verify + create). It lives outside the limiters so that the channel-store
 * cleanup timer can prune it once per tick instead of making every request
 * sweep the whole table.
 */

export const ATTEMPT_WINDOW_MS = 60_000;

const attempts = new Map<string, number[]>();

/**
 * Record an attempt for `key` if it is still under `limit` within the window.
 * Returns true when the attempt is allowed (and recorded).
 */
export function consumeAttempt(
  key: string,
  limit: number,
  windowMs: number = ATTEMPT_WINDOW_MS,
  at: number = Date.now(),
): boolean {
  const cutoff = at - windowMs;
  const timestamps = (attempts.get(key) ?? []).filter((ts) => ts > cutoff);

  if (timestamps.length >= limit) {
    // Keep the trimmed list so a blocked client cannot grow the array without
    // bound, but do not record the rejected attempt.
    attempts.set(key, timestamps);
    return false;
  }

  timestamps.push(at);
  attempts.set(key, timestamps);
  return true;
}

/** Drop stale timestamps and empty keys. Returns the number of removed keys. */
export function pruneAttempts(at: number = Date.now(), windowMs: number = ATTEMPT_WINDOW_MS): number {
  const cutoff = at - windowMs;
  let removed = 0;

  for (const [key, timestamps] of attempts) {
    const fresh = timestamps.filter((ts) => ts > cutoff);
    if (fresh.length === 0) {
      attempts.delete(key);
      removed++;
    } else {
      attempts.set(key, fresh);
    }
  }

  return removed;
}

/** Test/teardown hook: forget every tracked key. */
export function clearAttempts(): void {
  attempts.clear();
}

/** Test hook: how many attempts are currently tracked for `key`. */
export function getAttemptKeys(): string[] {
  return [...attempts.keys()];
}
