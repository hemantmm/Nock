import { decodeHex, hmacSha1, hmacSha256, shortDigest, timingSafeEqualBytes } from "../crypto";
import { headerValue } from "../headers";
import type { HeaderPair, VerificationCheck, VerificationResult } from "../types";
import { diagnoseMismatch } from "./diagnose";
import { invalid, valid } from "./result";

/**
 * GitHub signs the raw body with HMAC-SHA256 and sends
 * `X-Hub-Signature-256: sha256=<hex>`.
 * The published test vector is secret "It's a Secret to Everybody" and
 * payload "Hello, World!".
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyGithub(input: {
  body: Buffer;
  headers: HeaderPair[];
  secret: string;
}): VerificationResult {
  const checks: VerificationCheck[] = [];
  const sha256Header = headerValue(input.headers, "x-hub-signature-256");
  const sha1Header = headerValue(input.headers, "x-hub-signature");

  if (!sha256Header?.trim() && !sha1Header?.trim()) {
    checks.push({
      id: "header",
      label: "X-Hub-Signature-256 header",
      state: "fail",
      detail: "GitHub only sends this header when the webhook has a secret configured.",
    });
    return invalid(
      "github",
      "missing_header",
      "Missing X-Hub-Signature-256 header.",
      "GitHub sends X-Hub-Signature-256: sha256=<hex> when the webhook secret is set. This request has neither that header nor the legacy SHA-1 header.",
      checks,
    );
  }

  if (!sha256Header?.trim()) {
    checks.push({
      id: "header",
      label: "X-Hub-Signature-256 header",
      state: "fail",
      detail: "The SHA-256 header is missing. The legacy X-Hub-Signature (SHA-1) header is present.",
    });
    const legacy = sha1Matches(input.body, input.secret, sha1Header ?? "");
    checks.push({
      id: "legacy",
      label: "Legacy SHA-1 signature",
      state: legacy ? "pass" : "fail",
      detail: legacy
        ? "The sha1= digest matches, but GitHub's documented check is the SHA-256 header."
        : "The legacy SHA-1 digest does not match either.",
    });
    return invalid(
      "github",
      legacy ? "legacy_scheme_only" : "signature_mismatch",
      legacy
        ? "Only the legacy SHA-1 signature is present."
        : "The SHA-256 header is missing, and the SHA-1 signature does not match.",
      legacy
        ? "X-Hub-Signature-256 is absent. The older X-Hub-Signature sha1 digest matches this secret and body. GitHub still recommends rejecting deliveries that do not carry the SHA-256 signature."
        : "GitHub's SHA-256 header is missing, and the legacy SHA-1 digest does not match the saved secret and raw body.",
      checks,
    );
  }

  checks.push({
    id: "header",
    label: "X-Hub-Signature-256 header",
    state: "pass",
    detail: "Header is present.",
  });

  const raw = sha256Header.trim();
  const prefixed = raw.toLowerCase().startsWith("sha256=");
  const hexPart = prefixed ? raw.slice(raw.indexOf("=") + 1).trim() : raw;
  const decoded = decodeHex(hexPart);
  if (!decoded || decoded.length !== 32) {
    checks.push({
      id: "encoding",
      label: "sha256= hex digest",
      state: "fail",
      detail: "The header value is not a 64-character hex digest with an optional sha256= prefix.",
    });
    return invalid(
      "github",
      "malformed_header",
      "X-Hub-Signature-256 is not a SHA-256 hex digest.",
      "GitHub sends sha256= followed by 64 hex characters. This value could not be read as that digest.",
      checks,
    );
  }

  const expected = hmacSha256(input.secret, input.body);
  const digestMatches = timingSafeEqualBytes(decoded, expected);
  if (digestMatches && prefixed) {
    checks.push({
      id: "hmac",
      label: "HMAC-SHA256",
      state: "pass",
      detail: "sha256=<hex> matches HMAC-SHA256 of the raw body. The legacy sha1 header is not used for this verdict.",
    });
    return valid(
      "github",
      "GitHub signature is valid.",
      "X-Hub-Signature-256 matches HMAC-SHA256 of the exact request body using the webhook secret. Hex casing is ignored; the sha256= prefix is required.",
      checks,
    );
  }

  if (digestMatches && !prefixed) {
    checks.push({
      id: "encoding",
      label: "sha256= prefix",
      state: "fail",
      detail: "The digest matches, but GitHub always prefixes it with sha256=.",
    });
    return invalid(
      "github",
      "encoding_mismatch",
      "The digest matches, but the sha256= prefix is missing.",
      "HMAC-SHA256 of the raw body matches this hex, and the header is missing the sha256= prefix GitHub documents. The delivery is not in GitHub's format.",
      checks,
    );
  }

  const diagnosis = diagnoseMismatch({
    body: input.body,
    secret: input.secret,
    matches: (body, secret) => timingSafeEqualBytes(hmacSha256(secret, body), decoded),
  });
  checks.push({
    id: "hmac",
    label: "HMAC-SHA256",
    state: "fail",
    detail: `Expected ${shortDigest(expected.toString("hex"))}. ${diagnosis.detail}`,
  });
  return invalid("github", diagnosis.reason, diagnosis.summary, diagnosis.detail, checks);
}

function sha1Matches(body: Buffer, secret: string, header: string): boolean {
  const raw = header.trim();
  const hexPart = raw.toLowerCase().startsWith("sha1=") ? raw.slice(raw.indexOf("=") + 1).trim() : raw;
  const decoded = decodeHex(hexPart);
  if (!decoded) return false;
  return timingSafeEqualBytes(decoded, hmacSha1(secret, body));
}
