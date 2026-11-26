import type { HeaderPair, ProviderId, SigningEncoding, VerificationResult } from "../types";
import { verifyGithub } from "./github";
import { verifyHmac } from "./hmac";
import { verifyRazorpay } from "./razorpay";
import { verifyStripe } from "./stripe";

export type VerifyInput = {
  provider: ProviderId;
  secret: string;
  body: Buffer;
  headers: HeaderPair[];
  toleranceSeconds: number;
  signingHeader?: string | null;
  signingEncoding?: SigningEncoding | null;
  timestampHeader?: string | null;
  now?: Date;
};

export function verifyRequest(input: VerifyInput): VerificationResult {
  if (!input.secret) {
    return {
      status: "invalid",
      provider: input.provider,
      reason: "secret_unavailable",
      summary: "No signing secret is saved.",
      detail: "Choose a provider and save the webhook signing secret to verify captured requests.",
      checks: [
        {
          id: "secret",
          label: "Signing secret",
          state: "fail",
          detail: "The endpoint has a provider selected and no secret.",
        },
      ],
    };
  }

  switch (input.provider) {
    case "stripe":
      return verifyStripe({
        body: input.body,
        headers: input.headers,
        secret: input.secret,
        toleranceSeconds: input.toleranceSeconds,
        now: input.now,
      });
    case "github":
      return verifyGithub({ body: input.body, headers: input.headers, secret: input.secret });
    case "razorpay":
      return verifyRazorpay({ body: input.body, headers: input.headers, secret: input.secret });
    case "hmac_sha256":
      return verifyHmac({
        body: input.body,
        headers: input.headers,
        secret: input.secret,
        headerName: input.signingHeader?.trim() || "X-Signature-256",
        encoding: input.signingEncoding ?? "hex",
        timestampHeader: input.timestampHeader ?? null,
        toleranceSeconds: input.toleranceSeconds,
        now: input.now,
      });
  }
}

export { verifyStripe, verifyGithub, verifyRazorpay, verifyHmac };
