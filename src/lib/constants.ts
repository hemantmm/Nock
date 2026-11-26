export const PROVIDERS = ["stripe", "github", "razorpay", "shopify", "slack", "svix", "hmac_sha256"] as const;

export function maxBodyBytes(): number {
  const n = Number(process.env.HOOKTRACE_MAX_BODY_BYTES ?? 1_048_576);
  if (!Number.isFinite(n) || n < 32) return 1_048_576;
  return Math.min(Math.floor(n), 5_000_000);
}

export function ingestLimit(): number {
  return positiveInt(process.env.HOOKTRACE_INGEST_LIMIT, 120);
}

export function ingestIpLimit(): number {
  return positiveInt(process.env.HOOKTRACE_INGEST_IP_LIMIT, 240);
}

export function ingestWindowMs(): number {
  return positiveInt(process.env.HOOKTRACE_INGEST_WINDOW_MS, 60_000);
}

export function createLimit(): number {
  return positiveInt(process.env.HOOKTRACE_CREATE_LIMIT, 30);
}

export function defaultRetentionDays(): number {
  const n = positiveInt(process.env.EVENT_RETENTION_DAYS, 7);
  return Math.min(30, Math.max(1, n));
}

export function allowPrivateTargets(): boolean {
  return process.env.HOOKTRACE_ALLOW_PRIVATE_TARGETS === "true";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}
