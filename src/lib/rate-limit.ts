type WindowCounter = { count: number; resetAt: number };

const windows = new Map<string, WindowCounter>();

export type RateResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
};

export function consumeRate(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  prune(now);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0, limit };
  }
  if (existing.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit,
    };
  }
  existing.count += 1;
  return { ok: true, remaining: Math.max(0, limit - existing.count), retryAfterSec: 0, limit };
}

export function resetRateLimits(): void {
  windows.clear();
}

function prune(now: number): void {
  if (windows.size < 5000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}
