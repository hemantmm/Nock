import type { VerificationCheck, VerificationReason, VerificationResult, ProviderId } from "../types";

export function invalid(
  provider: ProviderId,
  reason: VerificationReason,
  summary: string,
  detail: string,
  checks: VerificationCheck[],
): VerificationResult {
  return { status: "invalid", provider, reason, summary, detail, checks };
}

export function valid(
  provider: ProviderId,
  summary: string,
  detail: string,
  checks: VerificationCheck[],
): VerificationResult {
  return { status: "valid", provider, reason: "ok", summary, detail, checks };
}
