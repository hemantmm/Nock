import type { VerificationReason } from "../types";

export type BodyVariant = {
  id: string;
  body: Buffer;
  reason: Extract<VerificationReason, "body_modified" | "encoding_mismatch">;
  summary: string;
  detail: string;
};

export function decodeUtf8(body: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

export function bodyVariants(body: Buffer): BodyVariant[] {
  const text = decodeUtf8(body);
  if (text === null) return [];
  const variants: BodyVariant[] = [];

  const push = (variant: BodyVariant) => {
    if (variant.body.equals(body) || variant.body.length === 0) return;
    variants.push(variant);
  };

  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    push({
      id: "strip_bom",
      body: body.subarray(3),
      reason: "encoding_mismatch",
      summary: "The signature matches the body with the UTF-8 BOM removed.",
      detail:
        "The HMAC matches after dropping the leading EF BB BF byte-order mark. The provider signed the payload without a BOM, so the bytes on the wire are not the bytes that were signed.",
    });
  }

  if (text.endsWith("\n")) {
    push({
      id: "strip_trailing_newline",
      body: Buffer.from(text.replace(/\r?\n$/, ""), "utf8"),
      reason: "body_modified",
      summary: "The signature matches the body with the trailing newline removed.",
      detail:
        "The HMAC matches the same payload without its trailing newline. A proxy, logger, or framework appended a newline after the provider signed the raw body.",
    });
  } else {
    push({
      id: "add_trailing_newline",
      body: Buffer.from(`${text}\n`, "utf8"),
      reason: "body_modified",
      summary: "The signature matches the body with a trailing newline added.",
      detail:
        "The HMAC matches the same payload plus a trailing newline. The signed bytes and the captured bytes differ by that newline.",
    });
  }

  if (text.includes("\r\n")) {
    push({
      id: "crlf_to_lf",
      body: Buffer.from(text.replace(/\r\n/g, "\n"), "utf8"),
      reason: "encoding_mismatch",
      summary: "The signature matches after CRLF newlines are converted to LF.",
      detail:
        "The HMAC matches when Windows-style CRLF line endings are normalized to LF. The newline encoding changed between signing and capture.",
    });
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const compact = JSON.stringify(parsed);
    push({
      id: "json_compact",
      body: Buffer.from(compact, "utf8"),
      reason: "encoding_mismatch",
      summary: "The signature matches the JSON after it was re-serialized.",
      detail:
        "The HMAC matches JSON.stringify of the parsed body, not the raw bytes. Providers sign the exact request body. Parsing and writing the JSON back changes whitespace and key order, so the signature no longer matches even when the data is the same.",
    });
    const pretty = JSON.stringify(parsed, null, 2);
    push({
      id: "json_pretty",
      body: Buffer.from(pretty, "utf8"),
      reason: "encoding_mismatch",
      summary: "The signature matches a pretty-printed encoding of this JSON.",
      detail:
        "The HMAC matches the body after it is parsed and pretty-printed with two-space indentation. The provider signed a different encoding of the same JSON document.",
    });
  } catch {
    // Not JSON, so re-serialization is not a useful guess.
  }

  return variants;
}

export type Diagnosis = {
  reason: VerificationReason;
  summary: string;
  detail: string;
};

export function diagnoseMismatch(input: {
  body: Buffer;
  secret: string;
  matches: (body: Buffer, secret: string) => boolean;
}): Diagnosis {
  const trimmed = input.secret.trim();
  if (trimmed !== input.secret && trimmed.length > 0 && input.matches(input.body, trimmed)) {
    return {
      reason: "secret_whitespace",
      summary: "The signing secret has surrounding whitespace.",
      detail:
        "The HMAC matches the secret with leading and trailing whitespace removed, and does not match the secret as saved. The extra whitespace is part of the key. Paste the secret again without a trailing newline.",
    };
  }

  for (const variant of bodyVariants(input.body)) {
    if (input.matches(variant.body, input.secret)) {
      return {
        reason: variant.reason,
        summary: variant.summary,
        detail: variant.detail,
      };
    }
  }

  return {
    reason: "signature_mismatch",
    summary: "The signature does not match this secret and body.",
    detail:
      "The HMAC does not match. Either the signing secret is wrong, or the raw body bytes differ from the bytes that were signed. No common change (trailing newline, CRLF, BOM, or JSON re-serialization) produced a match.",
  };
}
