import { hmacSha256, timingSafeEqualBytes } from "../crypto";
import { headerValue } from "../headers";
import type { HeaderPair, VerificationCheck, VerificationResult } from "../types";
import { invalid, valid } from "./result";

function decodeSecret(secret: string): Buffer | null {
  const value = secret.startsWith("whsec_") ? secret.slice(6) : "";
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "") ? decoded : null;
}

export function verifySvix(input: {
  body: Buffer; headers: HeaderPair[]; secret: string; toleranceSeconds: number; now?: Date;
}): VerificationResult {
  const idHeader = headerValue(input.headers, "svix-id") ?? headerValue(input.headers, "webhook-id") ?? "";
  const timestampHeader = headerValue(input.headers, "svix-timestamp") ?? headerValue(input.headers, "webhook-timestamp") ?? "";
  const signatureHeader = headerValue(input.headers, "svix-signature") ?? headerValue(input.headers, "webhook-signature") ?? "";
  const checks: VerificationCheck[] = [
    { id: "id", label: "svix-id / webhook-id", state: idHeader ? "pass" : "fail", detail: idHeader ? "Delivery ID is present." : "Delivery ID is missing." },
    { id: "timestamp", label: "svix-timestamp / webhook-timestamp", state: timestampHeader ? "pass" : "fail", detail: timestampHeader ? "Timestamp is present." : "Timestamp is missing." },
    { id: "signature", label: "svix-signature / webhook-signature", state: signatureHeader ? "pass" : "fail", detail: signatureHeader ? "Header is present." : "Header is missing." },
  ];
  if (!idHeader || !timestampHeader || !signatureHeader) return invalid("svix", "missing_header", "Svix signature headers are missing.",
    "Svix uses a delivery ID, unix timestamp, and versioned signature. Standard Webhooks header names are also accepted.", checks);
  if (!/^\d+$/.test(timestampHeader)) {
    checks.push({ id: "format", label: "Timestamp", state: "fail", detail: "Expected unix seconds." });
    return invalid("svix", "malformed_header", "Svix timestamp is malformed.", "The timestamp header must be unix seconds.", checks);
  }
  const timestamp = Number(timestampHeader);
  const age = Math.abs(Math.floor((input.now ?? new Date()).getTime() / 1000) - timestamp);
  const tolerance = input.toleranceSeconds;
  if (tolerance > 0 && age > tolerance) {
    checks.push({ id: "tolerance", label: "Timestamp tolerance", state: "fail", detail: `Age ${age}s is outside the ${tolerance}s window.` });
    return invalid("svix", "timestamp_out_of_tolerance", "Svix timestamp is outside the tolerance window.",
      `The timestamp is ${age} seconds from now and the tolerance is ${tolerance} seconds.`, checks);
  }
  checks.push({ id: "tolerance", label: "Timestamp tolerance", state: "pass", detail: tolerance <= 0 ? "Tolerance is disabled." : `Age ${age}s is inside ${tolerance}s.` });
  const secret = decodeSecret(input.secret);
  if (!secret) {
    checks.push({ id: "secret-format", label: "Signing secret", state: "fail", detail: "Expected a whsec_ secret containing base64 key bytes." });
    return invalid("svix", "malformed_header", "Svix signing secret is malformed.",
      "Paste the endpoint signing secret beginning with whsec_. The key bytes are base64 encoded after the prefix.", checks);
  }
  const signed = Buffer.concat([Buffer.from(`${idHeader}.${timestampHeader}.`, "utf8"), input.body]);
  const expected = hmacSha256(secret, signed);
  const candidates = signatureHeader.split(/\s+/).flatMap((part) => {
    const comma = part.indexOf(",");
    return comma > 0 && part.slice(0, comma) === "v1" ? [part.slice(comma + 1)] : [];
  });
  const matches = candidates.some((candidate) => {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(candidate)) return false;
    return timingSafeEqualBytes(Buffer.from(candidate, "base64"), expected);
  });
  if (!matches) {
    checks.push({ id: "hmac", label: "HMAC-SHA256", state: "fail", detail: "No v1 signature matches the signed delivery." });
    return invalid("svix", "signature_mismatch", "Svix signature does not match.",
      "The verifier checks v1 signatures over `<id>.<timestamp>.<raw body>` using the decoded whsec_ key.", checks);
  }
  checks.push({ id: "hmac", label: "HMAC-SHA256", state: "pass", detail: "A v1 signature matches the delivery ID, timestamp, and raw body." });
  return valid("svix", "Svix signature is valid.",
    "A v1 signature matches HMAC-SHA256 of `<id>.<timestamp>.<raw body>` using the decoded whsec_ key.", checks);
}
