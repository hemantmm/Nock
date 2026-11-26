import { decodeHex, hmacSha256, shortDigest, timingSafeEqualBytes } from "../crypto";
import { headerValue } from "../headers";
import type { HeaderPair, SigningEncoding, VerificationCheck, VerificationResult } from "../types";
import { diagnoseMismatch } from "./diagnose";
import { invalid, valid } from "./result";

export function verifyHmac(input: {
  body: Buffer;
  headers: HeaderPair[];
  secret: string;
  headerName: string;
  encoding: SigningEncoding;
  timestampHeader: string | null;
  toleranceSeconds: number;
  now?: Date;
}): VerificationResult {
  const headerName = input.headerName.trim() || "X-Signature-256";
  const presented = headerValue(input.headers, headerName);
  if (!presented?.trim()) {
    return invalid(
      "hmac_sha256",
      "missing_header",
      `Missing ${headerName} header.`,
      `The generic HMAC verifier reads the signature from ${headerName}. This request did not include it.`,
      [
        {
          id: "header",
          label: headerName,
          state: "fail",
          detail: "Header is missing.",
        },
      ],
    );
  }

  let message = input.body;
  const checks: VerificationCheck[] = [
    {
      id: "header",
      label: headerName,
      state: "pass",
      detail: "Header is present.",
    },
  ];

  if (input.timestampHeader?.trim()) {
    const stampHeader = input.timestampHeader.trim();
    const stampRaw = headerValue(input.headers, stampHeader)?.trim() ?? "";
    if (!/^\d+$/.test(stampRaw)) {
      checks.push({
        id: "timestamp",
        label: stampHeader,
        state: "fail",
        detail: stampRaw
          ? "The timestamp header is not a unix time in seconds."
          : "The configured timestamp header is missing.",
      });
      return invalid(
        "hmac_sha256",
        stampRaw ? "malformed_header" : "missing_header",
        stampRaw ? "Timestamp header is not a unix time." : `Missing ${stampHeader} header.`,
        "When a timestamp header is configured, the signed message is `<timestamp>.<raw body>` and the timestamp must be unix seconds.",
        checks,
      );
    }
    const timestamp = Number(stampRaw);
    const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const age = Math.abs(nowSec - timestamp);
    const tolerance = input.toleranceSeconds;
    if (tolerance > 0 && age > tolerance) {
      checks.push({
        id: "tolerance",
        label: "Timestamp tolerance",
        state: "fail",
        detail: `Age ${age}s is outside the ${tolerance}s window.`,
      });
      return invalid(
        "hmac_sha256",
        "timestamp_out_of_tolerance",
        "Timestamp is outside the tolerance window.",
        `The ${stampHeader} value is ${age} seconds from now and the tolerance is ${tolerance} seconds. The signed payload was not compared.`,
        checks,
      );
    }
    checks.push({
      id: "tolerance",
      label: "Timestamp tolerance",
      state: "pass",
      detail: tolerance <= 0 ? "Tolerance is disabled." : `Age ${age}s is inside ${tolerance}s.`,
    });
    message = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), input.body]);
  }

  const expected = hmacSha256(input.secret, message);
  const comparison = compareEncoding(input.encoding, presented.trim(), expected);
  if (comparison.ok) {
    checks.push({
      id: "hmac",
      label: "HMAC-SHA256",
      state: "pass",
      detail: comparison.detail,
    });
    return valid(
      "hmac_sha256",
      "HMAC signature is valid.",
      comparison.detail,
      checks,
    );
  }
  if (comparison.reason === "encoding_mismatch" || comparison.reason === "malformed_header") {
    checks.push({
      id: "encoding",
      label: "Signature encoding",
      state: "fail",
      detail: comparison.detail,
    });
    return invalid("hmac_sha256", comparison.reason, comparison.summary, comparison.detail, checks);
  }

  const diagnosis = diagnoseMismatch({
    body: input.body,
    secret: input.secret,
    matches: (body, secret) => {
      const nextMessage = input.timestampHeader?.trim()
        ? Buffer.concat([
            message.subarray(0, message.length - input.body.length),
            body,
          ])
        : body;
      const mac = hmacSha256(secret, nextMessage);
      return compareEncoding(input.encoding, presented.trim(), mac).ok;
    },
  });
  checks.push({
    id: "hmac",
    label: "HMAC-SHA256",
    state: "fail",
    detail: `Expected ${shortDigest(expected.toString("hex"))}. ${diagnosis.detail}`,
  });
  return invalid("hmac_sha256", diagnosis.reason, diagnosis.summary, diagnosis.detail, checks);
}

function compareEncoding(
  encoding: SigningEncoding,
  presented: string,
  expected: Buffer,
):
  | { ok: true; detail: string }
  | { ok: false; reason: "encoding_mismatch" | "malformed_header" | "signature_mismatch"; summary: string; detail: string } {
  if (encoding === "base64") {
    const standard = expected.toString("base64");
    const url = expected.toString("base64url");
    if (presented === standard) {
      return { ok: true, detail: "The header matches standard base64 of HMAC-SHA256." };
    }
    if (presented === url) {
      return {
        ok: false,
        reason: "encoding_mismatch",
        summary: "The digest matches base64url, not standard base64.",
        detail:
          "The HMAC matches, but the header is base64url (no padding, URL-safe alphabet). This verifier expects standard base64 for the base64 encoding option.",
      };
    }
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(presented)) {
      return {
        ok: false,
        reason: "malformed_header",
        summary: "The signature is not base64.",
        detail: "The selected encoding is base64, and the header is not a base64 digest.",
      };
    }
    return {
      ok: false,
      reason: "signature_mismatch",
      summary: "The signature does not match.",
      detail: "Base64 HMAC-SHA256 does not match the signed payload.",
    };
  }

  const prefixed = presented.toLowerCase().startsWith("sha256=");
  const hexPart = prefixed ? presented.slice(presented.indexOf("=") + 1).trim() : presented;
  const decoded = decodeHex(hexPart);
  if (!decoded || decoded.length !== 32) {
    return {
      ok: false,
      reason: "malformed_header",
      summary: "The signature is not a SHA-256 hex digest.",
      detail: "Expected 64 hex characters, optionally prefixed with sha256=.",
    };
  }
  if (!timingSafeEqualBytes(decoded, expected)) {
    return {
      ok: false,
      reason: "signature_mismatch",
      summary: "The signature does not match.",
      detail: "HMAC-SHA256 does not match the signed payload.",
    };
  }
  if (encoding === "prefixed_hex" && !prefixed) {
    return {
      ok: false,
      reason: "encoding_mismatch",
      summary: "The digest matches, but the sha256= prefix is missing.",
      detail: "This endpoint expects a sha256=<hex> header, like GitHub. The hex digest is correct and the prefix is not there.",
    };
  }
  if (encoding === "hex" && prefixed) {
    return {
      ok: false,
      reason: "encoding_mismatch",
      summary: "The digest matches, but a sha256= prefix was not expected.",
      detail: "This endpoint expects a bare hex digest. The digest is correct and the header includes a sha256= prefix.",
    };
  }
  return {
    ok: true,
    detail:
      encoding === "prefixed_hex"
        ? "sha256=<hex> matches HMAC-SHA256 of the signed payload."
        : "The bare hex digest matches HMAC-SHA256 of the signed payload.",
  };
}
