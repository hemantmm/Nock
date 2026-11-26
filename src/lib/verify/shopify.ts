import { hmacSha256, timingSafeEqualBytes } from "../crypto";
import { headerValue } from "../headers";
import type { HeaderPair, VerificationCheck, VerificationResult } from "../types";
import { invalid, valid } from "./result";

export function verifyShopify(input: { body: Buffer; headers: HeaderPair[]; secret: string }): VerificationResult {
  const headerName = "X-Shopify-Hmac-SHA256";
  const presented = headerValue(input.headers, headerName)?.trim() ?? "";
  const checks: VerificationCheck[] = [{
    id: "header", label: headerName, state: presented ? "pass" : "fail",
    detail: presented ? "Header is present." : "Header is missing.",
  }];
  if (!presented) return invalid("shopify", "missing_header", `Missing ${headerName} header.`,
    "Shopify signs the exact raw request body with HMAC-SHA256 and sends the digest as base64 in X-Shopify-Hmac-SHA256.", checks);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(presented)) {
    checks.push({ id: "encoding", label: "Base64 signature", state: "fail", detail: "Expected a 44-character base64 SHA-256 digest." });
    return invalid("shopify", "malformed_header", "Shopify signature is not valid base64.",
      "The header should contain a base64-encoded 32-byte HMAC-SHA256 digest.", checks);
  }
  const decoded = Buffer.from(presented, "base64");
  const expected = hmacSha256(input.secret, input.body);
  if (!timingSafeEqualBytes(decoded, expected)) {
    checks.push({ id: "hmac", label: "HMAC-SHA256", state: "fail", detail: "Base64 HMAC-SHA256 does not match the raw body." });
    return invalid("shopify", "signature_mismatch", "Shopify signature does not match.",
      "The header is well-formed, but it does not match HMAC-SHA256 of the exact request body using the saved secret.", checks);
  }
  checks.push({ id: "hmac", label: "HMAC-SHA256", state: "pass", detail: "Base64 HMAC-SHA256 matches the exact raw body." });
  return valid("shopify", "Shopify signature is valid.",
    "X-Shopify-Hmac-SHA256 matches HMAC-SHA256 of the exact request body using the app secret, encoded as base64.", checks);
}
