import { decodeHex, hmacSha256, sha256Hex, shortDigest, timingSafeEqualBytes } from "../crypto";
import { headerValue } from "../headers";
import type { HeaderPair, VerificationCheck, VerificationResult } from "../types";
import { diagnoseMismatch } from "./diagnose";
import { invalid, valid } from "./result";

type ParsedStripe = {
  timestamp: number | null;
  v1: string[];
  v0: string[];
  secretHint?: string;
  payloadHint?: string;
};

export function parseStripeSignature(header: string): ParsedStripe {
  const parsed: ParsedStripe = { timestamp: null, v1: [], v0: [] };
  for (const part of header.split(",")) {
    const item = part.trim();
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) parsed.timestamp = Number(value);
    else if (key === "v1" && value) parsed.v1.push(value);
    else if (key === "v0" && value) parsed.v0.push(value);
    else if (key === "secret" && value) parsed.secretHint = value;
    else if (key === "payload" && value) parsed.payloadHint = value;
  }
  return parsed;
}

function signedMessage(timestamp: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body]);
}

function macMatches(timestamp: number, body: Buffer, secret: string, signatures: string[]): boolean {
  const expected = hmacSha256(secret, signedMessage(timestamp, body));
  return signatures.some((signature) => {
    const decoded = decodeHex(signature);
    return !!decoded && timingSafeEqualBytes(decoded, expected);
  });
}

export function verifyStripe(input: {
  body: Buffer;
  headers: HeaderPair[];
  secret: string;
  toleranceSeconds: number;
  now?: Date;
}): VerificationResult {
  const checks: VerificationCheck[] = [];
  const header = headerValue(input.headers, "stripe-signature");
  if (!header?.trim()) {
    checks.push({
      id: "header",
      label: "Stripe-Signature header",
      state: "fail",
      detail: "Stripe sends Stripe-Signature on every signed delivery. This request did not include it.",
    });
    return invalid(
      "stripe",
      "missing_header",
      "Missing Stripe-Signature header.",
      "Stripe signs the raw body and puts t=<unix>,v1=<hex> in the Stripe-Signature header. Without that header there is nothing to check.",
      checks,
    );
  }
  checks.push({
    id: "header",
    label: "Stripe-Signature header",
    state: "pass",
    detail: "Header is present.",
  });

  const parsed = parseStripeSignature(header);
  const timestamp = parsed.timestamp;
  if (timestamp === null) {
    checks.push({
      id: "timestamp",
      label: "Timestamp",
      state: "fail",
      detail: "No t=<unix seconds> entry was found. A Stripe-Signature looks like t=1492774577,v1=<hex>.",
    });
    return invalid(
      "stripe",
      "malformed_header",
      "Stripe-Signature is missing a timestamp.",
      "The header did not contain a numeric t= value. Stripe's scheme is t=<unix>,v1=<hmac>, and other entries are ignored.",
      checks,
    );
  }
  checks.push({
    id: "timestamp",
    label: "Timestamp parsed",
    state: "pass",
    detail: `t=${timestamp}.`,
  });

  if (parsed.v1.length === 0) {
    const extra = parsed.v0.length
      ? " A v0 value is present. v0 is a test scheme and is never accepted."
      : "";
    checks.push({
      id: "scheme",
      label: "v1 signature",
      state: "fail",
      detail: `No v1 signature was found.${extra}`,
    });
    return invalid(
      "stripe",
      "malformed_header",
      "No v1 signature in Stripe-Signature.",
      "The live scheme is v1, an HMAC-SHA256 hex digest. v0 and any other scheme are ignored, and this header had no v1 entry.",
      checks,
    );
  }
  checks.push({
    id: "scheme",
    label: "v1 signature",
    state: "pass",
    detail:
      parsed.v1.length === 1
        ? "One v1 signature. Other schemes, including v0, are ignored."
        : `${parsed.v1.length} v1 signatures. Stripe sends one per active secret during a rollover. Any match is enough.`,
  });

  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const age = Math.abs(nowSec - timestamp);
  const tolerance = input.toleranceSeconds;
  const timestampFailed = tolerance > 0 && age > tolerance;
  checks.push({
    id: "tolerance",
    label: "Timestamp tolerance",
    state: timestampFailed ? "fail" : "pass",
    detail: timestampFailed
      ? `The timestamp is ${age}s from now. The allowed window is ${tolerance}s. Stripe's libraries default to 300 seconds.`
      : tolerance <= 0
        ? "Tolerance is 0, so the timestamp window is not enforced. Stripe's libraries treat an explicit tolerance of 0 the same way."
        : `Age ${age}s is inside the ${tolerance}s window.`,
  });

  const matched = macMatches(timestamp, input.body, input.secret, parsed.v1);
  if (matched && !timestampFailed) {
    checks.push({
      id: "hmac",
      label: "HMAC-SHA256",
      state: "pass",
      detail: "A v1 signature matches HMAC-SHA256 of `<timestamp>.<raw body>` with the saved secret as the key.",
    });
    return valid(
      "stripe",
      "Stripe signature is valid.",
      "The v1 HMAC matches the raw body and the timestamp is inside the tolerance window. v0 and unsigned debug entries were ignored.",
      checks,
    );
  }

  if (matched && timestampFailed) {
    checks.push({
      id: "hmac",
      label: "HMAC-SHA256",
      state: "pass",
      detail: "The v1 signature matches. The delivery is still rejected because the timestamp is outside the tolerance window.",
    });
    return invalid(
      "stripe",
      "timestamp_out_of_tolerance",
      "Timestamp is outside the tolerance window.",
      `The signature matches, so the secret and the raw body are fine. t=${timestamp} is ${age} seconds from now and the tolerance is ${tolerance} seconds. This is Stripe's replay protection.`,
      checks,
    );
  }

  const diagnosis = diagnoseMismatch({
    body: input.body,
    secret: input.secret,
    matches: (body, secret) => macMatches(timestamp, body, secret, parsed.v1),
  });
  const refined =
    diagnosis.reason === "signature_mismatch"
      ? refineWithStripeHints(parsed, input.secret, input.body) ?? diagnosis
      : diagnosis;

  checks.push({
    id: "hmac",
    label: "HMAC-SHA256",
    state: "fail",
    detail: `Expected digest ${shortDigest(hmacSha256(input.secret, signedMessage(timestamp, input.body)).toString("hex"))}. ${refined.detail}`,
  });

  if (timestampFailed) {
    return invalid(
      "stripe",
      "timestamp_out_of_tolerance",
      "Timestamp is outside the tolerance window, and the signature does not match.",
      `The timestamp is ${age}s from now (tolerance ${tolerance}s). The v1 HMAC also failed: ${refined.detail}`,
      checks,
    );
  }

  return invalid("stripe", refined.reason, refined.summary, refined.detail, checks);
}

function refineWithStripeHints(
  parsed: ParsedStripe,
  secret: string,
  body: Buffer,
): { reason: VerificationResult["reason"]; summary: string; detail: string } | null {
  const secretHint = parsed.secretHint;
  if (secretHint?.includes("*")) {
    const suffix = secretHint.match(/([^*]{2,8})$/)?.[1];
    if (suffix && (secret.length !== secretHint.length || !secret.endsWith(suffix))) {
      return {
        reason: "wrong_secret",
        summary: "The signing secret does not match this Stripe endpoint.",
        detail: `Stripe attached an unsigned secret hint that is ${secretHint.length} characters and ends in ${suffix}. The secret saved here is ${secret.length} characters and ends in ${secret.slice(-4) || "(empty)"}. Use the signing secret for this exact endpoint. The hint is not authenticated; the v1 HMAC failed as well.`,
      };
    }
  }

  const payloadHint = parsed.payloadHint;
  if (payloadHint && /^[0-9a-fA-F]{6,64}$/.test(payloadHint)) {
    const hint = payloadHint.toLowerCase();
    const bodyHash = sha256Hex(body);
    if (bodyHash.endsWith(hint)) {
      return {
        reason: "wrong_secret",
        summary: "The body matches Stripe's payload hint, so the secret is wrong.",
        detail: `The SHA-256 of this raw body ends in ${hint}, matching the unsigned payload hint. These are the bytes Stripe signed. The v1 HMAC still failed, which means the saved secret is not the one Stripe used for this endpoint.`,
      };
    }
    return {
      reason: "body_modified",
      summary: "The raw body was modified before verification.",
      detail: `Stripe's unsigned payload hint says the body SHA-256 should end in ${hint}. This body ends in ${bodyHash.slice(-hint.length)}. The raw bytes changed, often because a framework parsed the JSON and serialized it again. The hint is not a signature; the HMAC failed too.`,
    };
  }
  return null;
}
