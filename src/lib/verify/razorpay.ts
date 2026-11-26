import { decodeHex, hmacSha256, shortDigest, timingSafeEqualBytes } from "../crypto";
import { headerValue } from "../headers";
import type { HeaderPair, VerificationResult } from "../types";
import { diagnoseMismatch } from "./diagnose";
import { invalid, valid } from "./result";

/**
 * Razorpay signs the raw webhook body with HMAC-SHA256 and sends the
 * lowercase hex digest in `X-Razorpay-Signature`. There is no timestamp.
 * https://razorpay.com/docs/webhooks/validate-test/
 * The official Node helper is `validateWebhookSignature(body, signature, secret)`.
 */
export function verifyRazorpay(input: {
  body: Buffer;
  headers: HeaderPair[];
  secret: string;
}): VerificationResult {
  const header = headerValue(input.headers, "x-razorpay-signature");
  if (!header?.trim()) {
    return invalid(
      "razorpay",
      "missing_header",
      "Missing X-Razorpay-Signature header.",
      "Razorpay sends the HMAC-SHA256 hex digest of the raw body in X-Razorpay-Signature when a webhook secret is set.",
      [
        {
          id: "header",
          label: "X-Razorpay-Signature header",
          state: "fail",
          detail: "Header is missing.",
        },
      ],
    );
  }

  const raw = header.trim();
  const prefixed = raw.toLowerCase().startsWith("sha256=");
  const presented = prefixed ? raw.slice(raw.indexOf("=") + 1).trim() : raw;
  const decoded = decodeHex(presented);
  if (!decoded || decoded.length !== 32) {
    return invalid(
      "razorpay",
      "malformed_header",
      "X-Razorpay-Signature is not a SHA-256 hex digest.",
      "Razorpay's header is the bare lowercase hex HMAC-SHA256 of the raw body. This value is not 64 hex characters.",
      [
        {
          id: "header",
          label: "X-Razorpay-Signature header",
          state: "pass",
          detail: "Header is present.",
        },
        {
          id: "encoding",
          label: "Hex digest",
          state: "fail",
          detail: "Value is not a 32-byte hex digest.",
        },
      ],
    );
  }

  const expected = hmacSha256(input.secret, input.body);
  const digestMatches = timingSafeEqualBytes(decoded, expected);
  if (digestMatches && !prefixed && presented === presented.toLowerCase()) {
    return valid(
      "razorpay",
      "Razorpay signature is valid.",
      "X-Razorpay-Signature matches HMAC-SHA256 of the exact request body, hex encoded, using the webhook secret. Razorpay does not sign a timestamp.",
      [
        {
          id: "header",
          label: "X-Razorpay-Signature header",
          state: "pass",
          detail: "Header is present.",
        },
        {
          id: "hmac",
          label: "HMAC-SHA256",
          state: "pass",
          detail: "Bare lowercase hex digest matches the raw body.",
        },
      ],
    );
  }

  if (digestMatches && prefixed) {
    return invalid(
      "razorpay",
      "encoding_mismatch",
      "The digest matches, but Razorpay does not use a sha256= prefix.",
      "The HMAC matches, and the header is prefixed with sha256=. Razorpay sends the bare hex digest and compares it as a string. GitHub's prefix does not belong on this header.",
      [
        {
          id: "encoding",
          label: "Hex encoding",
          state: "fail",
          detail: "A sha256= prefix was present. Razorpay's header is bare hex.",
        },
      ],
    );
  }

  if (digestMatches && presented !== presented.toLowerCase()) {
    return invalid(
      "razorpay",
      "encoding_mismatch",
      "The digest matches, but the hex is not lowercase.",
      "Razorpay's SDK compares the header to a lowercase hex digest with a normal string compare. This value is the right digest with different casing, so their helper would reject it.",
      [
        {
          id: "encoding",
          label: "Lowercase hex",
          state: "fail",
          detail: "Digest bytes match, character casing does not.",
        },
      ],
    );
  }

  const diagnosis = diagnoseMismatch({
    body: input.body,
    secret: input.secret,
    matches: (body, secret) => timingSafeEqualBytes(hmacSha256(secret, body), decoded),
  });
  return invalid("razorpay", diagnosis.reason, diagnosis.summary, diagnosis.detail, [
    {
      id: "header",
      label: "X-Razorpay-Signature header",
      state: "pass",
      detail: "Header is present.",
    },
    {
      id: "hmac",
      label: "HMAC-SHA256",
      state: "fail",
      detail: `Expected ${shortDigest(expected.toString("hex"))}. ${diagnosis.detail}`,
    },
  ]);
}
