import type { ProviderId, SigningEncoding } from "./types";

export function isProvider(value: string | null | undefined): value is ProviderId {
  return value === "stripe" || value === "github" || value === "razorpay" || value === "hmac_sha256";
}

export function isSigningEncoding(value: string | null | undefined): value is SigningEncoding {
  return value === "hex" || value === "prefixed_hex" || value === "base64";
}
