import { decodeHex, hmacSha256, timingSafeEqualBytes } from "../crypto";
import { headerValue } from "../headers";
import type { HeaderPair, VerificationCheck, VerificationResult } from "../types";
import { invalid, valid } from "./result";

export function verifySlack(input: {
  body: Buffer; headers: HeaderPair[]; secret: string; toleranceSeconds: number; now?: Date;
}): VerificationResult {
  const headerName = "X-Slack-Signature";
  const signature = headerValue(input.headers, headerName)?.trim() ?? "";
  const timestampHeader = "X-Slack-Request-Timestamp";
  const timestampRaw = headerValue(input.headers, timestampHeader)?.trim() ?? "";
  const checks: VerificationCheck[] = [
    { id: "header", label: headerName, state: signature ? "pass" : "fail", detail: signature ? "Header is present." : "Header is missing." },
    { id: "timestamp", label: timestampHeader, state: timestampRaw ? "pass" : "fail", detail: timestampRaw ? "Header is present." : "Header is missing." },
  ];
  if (!signature || !timestampRaw) return invalid("slack", "missing_header", "Slack signature headers are missing.",
    "Slack requests include X-Slack-Signature and X-Slack-Request-Timestamp. The signature covers the timestamp and raw body.", checks);
  if (!/^\d+$/.test(timestampRaw) || !/^v0=[0-9a-fA-F]{64}$/.test(signature)) {
    checks.push({ id: "format", label: "Slack signature format", state: "fail", detail: "Expected a unix timestamp and v0=<64 hex characters>." });
    return invalid("slack", "malformed_header", "Slack signature headers are malformed.",
      "Slack uses a unix timestamp and a v0-prefixed hexadecimal SHA-256 signature.", checks);
  }
  const timestamp = Number(timestampRaw);
  const age = Math.abs(Math.floor((input.now ?? new Date()).getTime() / 1000) - timestamp);
  const tolerance = input.toleranceSeconds;
  if (tolerance > 0 && age > tolerance) {
    checks.push({ id: "tolerance", label: "Timestamp tolerance", state: "fail", detail: `Age ${age}s is outside the ${tolerance}s window.` });
    return invalid("slack", "timestamp_out_of_tolerance", "Slack request timestamp is outside the tolerance window.",
      `The ${timestampHeader} value is ${age} seconds from now and the tolerance is ${tolerance} seconds.`, checks);
  }
  checks.push({ id: "tolerance", label: "Timestamp tolerance", state: "pass", detail: tolerance <= 0 ? "Tolerance is disabled." : `Age ${age}s is inside ${tolerance}s.` });
  const expected = hmacSha256(input.secret, Buffer.concat([Buffer.from(`v0:${timestampRaw}:`, "utf8"), input.body]));
  const decoded = decodeHex(signature.slice(3));
  if (!decoded || !timingSafeEqualBytes(decoded, expected)) {
    checks.push({ id: "hmac", label: "HMAC-SHA256", state: "fail", detail: "The v0 digest does not match the timestamp and raw body." });
    return invalid("slack", "signature_mismatch", "Slack signature does not match.",
      "HMAC-SHA256 of `v0:<timestamp>:<raw body>` does not match X-Slack-Signature.", checks);
  }
  checks.push({ id: "hmac", label: "HMAC-SHA256", state: "pass", detail: "The v0 digest matches the timestamp and raw body." });
  return valid("slack", "Slack signature is valid.",
    "X-Slack-Signature matches HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the signing secret.", checks);
}
