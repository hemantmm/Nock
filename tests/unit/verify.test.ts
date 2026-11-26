import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithub } from "../../src/lib/verify/github";
import { verifyHmac } from "../../src/lib/verify/hmac";
import { verifyRazorpay } from "../../src/lib/verify/razorpay";
import { verifyStripe } from "../../src/lib/verify/stripe";

const STRIPE_SECRET = "whsec_test_secret";
const STRIPE_PAYLOAD = JSON.stringify({ id: "evt_test_webhook", object: "event" }, null, 2);
const STRIPE_TIMESTAMP = 1492774577;
const STRIPE_V1 = "c2f890decbc5ede7c5060bb9a6d31e0626a4342bacb9aeae2adb1bcea72f9812";

const GITHUB_SECRET = "It's a Secret to Everybody";
const GITHUB_PAYLOAD = "Hello, World!";
const GITHUB_SHA256 = "757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
const GITHUB_SHA1 = "01dc10d0c83e72ed246219cdd91669667fe2ca59";

const RAZORPAY_SECRET = "rzp_test_webhook_secret";
const RAZORPAY_BODY = '{"entity":"event","event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test"}}}}';
const RAZORPAY_SIG = "68c6e3535fcc0c6369cc8f9b5c15d7d6e8883d947ffce79189f3adea82cc2031";

function stripeHeader(signature = STRIPE_V1, extra = ""): string {
  return `t=${STRIPE_TIMESTAMP},v1=${signature}${extra}`;
}

describe("Stripe signatures", () => {
  const now = new Date(STRIPE_TIMESTAMP * 1000);

  it("accepts the stripe-node fixture signed as HMAC-SHA256 of t.rawBody", () => {
    const result = verifyStripe({
      body: Buffer.from(STRIPE_PAYLOAD),
      headers: [{ name: "Stripe-Signature", value: stripeHeader() }],
      secret: STRIPE_SECRET,
      toleranceSeconds: 300,
      now,
    });
    expect(result.status).toBe("valid");
    expect(result.reason).toBe("ok");
    expect(result.checks.find((check) => check.id === "hmac")?.state).toBe("pass");
  });

  it("ignores v0 and accepts one matching v1 among several", () => {
    const result = verifyStripe({
      body: Buffer.from(STRIPE_PAYLOAD),
      headers: [{ name: "stripe-signature", value: `${stripeHeader()},v1=potato,v0=deadbeef` }],
      secret: STRIPE_SECRET,
      toleranceSeconds: 300,
      now,
    });
    expect(result.status).toBe("valid");
  });

  it("rejects a missing header, a header without t, and a header without v1", () => {
    expect(
      verifyStripe({
        body: Buffer.from(STRIPE_PAYLOAD),
        headers: [],
        secret: STRIPE_SECRET,
        toleranceSeconds: 300,
        now,
      }).reason,
    ).toBe("missing_header");
    expect(
      verifyStripe({
        body: Buffer.from(STRIPE_PAYLOAD),
        headers: [{ name: "Stripe-Signature", value: "v1=abc" }],
        secret: STRIPE_SECRET,
        toleranceSeconds: 300,
        now,
      }).reason,
    ).toBe("malformed_header");
    expect(
      verifyStripe({
        body: Buffer.from(STRIPE_PAYLOAD),
        headers: [{ name: "Stripe-Signature", value: `t=${STRIPE_TIMESTAMP},v0=abc` }],
        secret: STRIPE_SECRET,
        toleranceSeconds: 300,
        now,
      }).reason,
    ).toBe("malformed_header");
  });

  it("rejects a matching signature outside the tolerance window", () => {
    const result = verifyStripe({
      body: Buffer.from(STRIPE_PAYLOAD),
      headers: [{ name: "Stripe-Signature", value: stripeHeader() }],
      secret: STRIPE_SECRET,
      toleranceSeconds: 300,
      now: new Date((STRIPE_TIMESTAMP + 1000) * 1000),
    });
    expect(result.status).toBe("invalid");
    expect(result.reason).toBe("timestamp_out_of_tolerance");
    expect(result.detail).toMatch(/signature matches/i);
  });

  it("treats an explicit tolerance of 0 as disabled, matching Stripe's libraries", () => {
    const result = verifyStripe({
      body: Buffer.from(STRIPE_PAYLOAD),
      headers: [{ name: "Stripe-Signature", value: stripeHeader() }],
      secret: STRIPE_SECRET,
      toleranceSeconds: 0,
      now: new Date((STRIPE_TIMESTAMP + 10_000) * 1000),
    });
    expect(result.status).toBe("valid");
  });

  it("explains a wrong secret when Stripe's unsigned payload hint matches the body", () => {
    const suffix = createHash("sha256").update(STRIPE_PAYLOAD).digest("hex").slice(-8);
    const result = verifyStripe({
      body: Buffer.from(STRIPE_PAYLOAD),
      headers: [
        {
          name: "Stripe-Signature",
          value: stripeHeader("ab".repeat(32), `,payload=${suffix}`),
        },
      ],
      secret: "whsec_wrong_secret",
      toleranceSeconds: 0,
      now,
    });
    expect(result.reason).toBe("wrong_secret");
    expect(result.detail).toMatch(/unsigned/i);
  });

  it("explains a modified body when the payload hint does not match", () => {
    const result = verifyStripe({
      body: Buffer.from(`${STRIPE_PAYLOAD} `),
      headers: [
        {
          name: "Stripe-Signature",
          value: stripeHeader("ab".repeat(32), ",payload=141b998e"),
        },
      ],
      secret: STRIPE_SECRET,
      toleranceSeconds: 0,
      now,
    });
    expect(result.reason).toBe("body_modified");
  });

  it("explains surrounding whitespace on the secret", () => {
    const result = verifyStripe({
      body: Buffer.from(STRIPE_PAYLOAD),
      headers: [{ name: "Stripe-Signature", value: stripeHeader() }],
      secret: `\n${STRIPE_SECRET} `,
      toleranceSeconds: 300,
      now,
    });
    expect(result.reason).toBe("secret_whitespace");
  });

  it("explains JSON that was re-serialized", () => {
    const compact = JSON.stringify(JSON.parse(STRIPE_PAYLOAD));
    const signed = createHmac("sha256", STRIPE_SECRET).update(`${STRIPE_TIMESTAMP}.${compact}`).digest("hex");
    const result = verifyStripe({
      body: Buffer.from(STRIPE_PAYLOAD),
      headers: [{ name: "Stripe-Signature", value: stripeHeader(signed) }],
      secret: STRIPE_SECRET,
      toleranceSeconds: 300,
      now,
    });
    expect(result.status).toBe("invalid");
    expect(result.reason).toBe("encoding_mismatch");
    expect(result.summary).toMatch(/re-serialized/i);
  });
});

describe("GitHub signatures", () => {
  it("accepts the official Hello, World! test vector", () => {
    const result = verifyGithub({
      body: Buffer.from(GITHUB_PAYLOAD),
      headers: [{ name: "X-Hub-Signature-256", value: `sha256=${GITHUB_SHA256}` }],
      secret: GITHUB_SECRET,
    });
    expect(result.status).toBe("valid");
    expect(GITHUB_SHA256).toBe("757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17");
  });

  it("accepts uppercase hex and rejects a missing sha256= prefix", () => {
    expect(
      verifyGithub({
        body: Buffer.from(GITHUB_PAYLOAD),
        headers: [{ name: "X-Hub-Signature-256", value: `sha256=${GITHUB_SHA256.toUpperCase()}` }],
        secret: GITHUB_SECRET,
      }).status,
    ).toBe("valid");
    const bare = verifyGithub({
      body: Buffer.from(GITHUB_PAYLOAD),
      headers: [{ name: "X-Hub-Signature-256", value: GITHUB_SHA256 }],
      secret: GITHUB_SECRET,
    });
    expect(bare.reason).toBe("encoding_mismatch");
  });

  it("reports a legacy SHA-1-only delivery", () => {
    const result = verifyGithub({
      body: Buffer.from(GITHUB_PAYLOAD),
      headers: [{ name: "X-Hub-Signature", value: `sha1=${GITHUB_SHA1}` }],
      secret: GITHUB_SECRET,
    });
    expect(result.reason).toBe("legacy_scheme_only");
  });

  it("reports a missing header and a body with an extra newline", () => {
    expect(
      verifyGithub({ body: Buffer.from(GITHUB_PAYLOAD), headers: [], secret: GITHUB_SECRET }).reason,
    ).toBe("missing_header");
    const signed = createHmac("sha256", GITHUB_SECRET).update(`${GITHUB_PAYLOAD}\n`).digest("hex");
    const result = verifyGithub({
      body: Buffer.from(GITHUB_PAYLOAD),
      headers: [{ name: "X-Hub-Signature-256", value: `sha256=${signed}` }],
      secret: GITHUB_SECRET,
    });
    expect(result.reason).toBe("body_modified");
  });
});

describe("Razorpay signatures", () => {
  it("accepts HMAC-SHA256 of the raw body as bare lowercase hex", () => {
    const result = verifyRazorpay({
      body: Buffer.from(RAZORPAY_BODY),
      headers: [{ name: "X-Razorpay-Signature", value: RAZORPAY_SIG }],
      secret: RAZORPAY_SECRET,
    });
    expect(result.status).toBe("valid");
  });

  it("rejects a sha256= prefix and uppercase hex as encoding mismatches", () => {
    expect(
      verifyRazorpay({
        body: Buffer.from(RAZORPAY_BODY),
        headers: [{ name: "X-Razorpay-Signature", value: `sha256=${RAZORPAY_SIG}` }],
        secret: RAZORPAY_SECRET,
      }).reason,
    ).toBe("encoding_mismatch");
    expect(
      verifyRazorpay({
        body: Buffer.from(RAZORPAY_BODY),
        headers: [{ name: "X-Razorpay-Signature", value: RAZORPAY_SIG.toUpperCase() }],
        secret: RAZORPAY_SECRET,
      }).reason,
    ).toBe("encoding_mismatch");
  });

  it("explains a re-serialized JSON body and a missing header", () => {
    expect(
      verifyRazorpay({ body: Buffer.from(RAZORPAY_BODY), headers: [], secret: RAZORPAY_SECRET }).reason,
    ).toBe("missing_header");
    const pretty = JSON.stringify(JSON.parse(RAZORPAY_BODY), null, 2);
    const result = verifyRazorpay({
      body: Buffer.from(pretty),
      headers: [{ name: "x-razorpay-signature", value: RAZORPAY_SIG }],
      secret: RAZORPAY_SECRET,
    });
    expect(result.reason).toBe("encoding_mismatch");
    expect(result.detail).toMatch(/raw/i);
  });

  it("does not accept a different secret", () => {
    const result = verifyRazorpay({
      body: Buffer.from(RAZORPAY_BODY),
      headers: [{ name: "X-Razorpay-Signature", value: RAZORPAY_SIG }],
      secret: "other-secret",
    });
    expect(result.status).toBe("invalid");
    expect(result.reason).toBe("signature_mismatch");
  });
});

describe("generic HMAC-SHA256", () => {
  const body = Buffer.from('{"ok":true}');
  const secret = "generic-secret";
  const mac = createHmac("sha256", secret).update(body).digest();

  it("checks bare hex, a sha256= prefix, and standard base64", () => {
    expect(
      verifyHmac({
        body,
        headers: [{ name: "X-Signature-256", value: mac.toString("hex") }],
        secret,
        headerName: "X-Signature-256",
        encoding: "hex",
        timestampHeader: null,
        toleranceSeconds: 300,
      }).status,
    ).toBe("valid");
    expect(
      verifyHmac({
        body,
        headers: [{ name: "X-Signature-256", value: `sha256=${mac.toString("hex")}` }],
        secret,
        headerName: "X-Signature-256",
        encoding: "prefixed_hex",
        timestampHeader: null,
        toleranceSeconds: 300,
      }).status,
    ).toBe("valid");
    expect(
      verifyHmac({
        body,
        headers: [{ name: "X-Signature-256", value: mac.toString("base64") }],
        secret,
        headerName: "X-Signature-256",
        encoding: "base64",
        timestampHeader: null,
        toleranceSeconds: 300,
      }).status,
    ).toBe("valid");
  });

  it("flags a prefix mismatch and a stale timestamp", () => {
    expect(
      verifyHmac({
        body,
        headers: [{ name: "X-Signature-256", value: mac.toString("hex") }],
        secret,
        headerName: "X-Signature-256",
        encoding: "prefixed_hex",
        timestampHeader: null,
        toleranceSeconds: 300,
      }).reason,
    ).toBe("encoding_mismatch");

    const timestamp = 1_700_000_000;
    const signed = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
    const result = verifyHmac({
      body,
      headers: [
        { name: "X-Signature-256", value: signed },
        { name: "X-Timestamp", value: String(timestamp) },
      ],
      secret,
      headerName: "X-Signature-256",
      encoding: "hex",
      timestampHeader: "X-Timestamp",
      toleranceSeconds: 300,
      now: new Date((timestamp + 1000) * 1000),
    });
    expect(result.reason).toBe("timestamp_out_of_tolerance");
  });

  it("accepts timestamp.rawBody inside the window", () => {
    const timestamp = 1_700_000_000;
    const signed = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
    const result = verifyHmac({
      body,
      headers: [
        { name: "X-Signature-256", value: signed },
        { name: "X-Timestamp", value: String(timestamp) },
      ],
      secret,
      headerName: "X-Signature-256",
      encoding: "hex",
      timestampHeader: "X-Timestamp",
      toleranceSeconds: 300,
      now: new Date(timestamp * 1000),
    });
    expect(result.status).toBe("valid");
  });
});
