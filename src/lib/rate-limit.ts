import { createHash } from "node:crypto";
import { prisma } from "./db";

export type RateResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
};

type CounterRow = { count: number; resetAt: Date };

/** Atomically consume a shared PostgreSQL-backed rate-limit slot. */
export async function consumeRate(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const storedKey = createHash("sha256").update(key).digest("hex");
  const rows = await prisma.$queryRaw<CounterRow[]>`
    INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
    VALUES (${storedKey}, 1, NOW() + (${windowMs} * INTERVAL '1 millisecond'))
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE
        WHEN "RateLimitCounter"."resetAt" <= NOW() THEN 1
        ELSE "RateLimitCounter"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitCounter"."resetAt" <= NOW()
          THEN NOW() + (${windowMs} * INTERVAL '1 millisecond')
        ELSE "RateLimitCounter"."resetAt"
      END
    RETURNING "count", "resetAt"
  `;
  const row = rows[0];
  if (!row) throw new Error("Rate-limit counter was not returned.");
  const retryAfterSec = Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
  const ok = row.count <= limit;
  return {
    ok,
    remaining: ok ? Math.max(0, limit - row.count) : 0,
    retryAfterSec: ok ? 0 : retryAfterSec,
    limit,
  };
}

export async function resetRateLimits(): Promise<void> {
  await prisma.rateLimitCounter.deleteMany();
}
