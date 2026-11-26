import { describe, expect, it } from "vitest";
import { isSensitiveHeader, redactHeaderValue, redactHeaders } from "../../src/lib/redact";

describe("redaction", () => {
  it("masks authorization, cookies, and signature headers", () => {
    expect(isSensitiveHeader("Authorization")).toBe(true);
    expect(isSensitiveHeader("cookie")).toBe(true);
    expect(isSensitiveHeader("stripe-signature")).toBe(true);
    expect(isSensitiveHeader("X-Hub-Signature-256")).toBe(true);
    expect(isSensitiveHeader("X-Razorpay-Signature")).toBe(true);
    expect(isSensitiveHeader("X-Api-Key")).toBe(true);
    expect(redactHeaderValue("Authorization", "Bearer super-secret-token")).toBe("Bear…oken");
    expect(redactHeaderValue("Authorization", "short")).toBe("[redacted]");
  });

  it("leaves ordinary headers alone", () => {
    expect(isSensitiveHeader("content-type")).toBe(false);
    expect(isSensitiveHeader("x-github-event")).toBe(false);
    expect(isSensitiveHeader("x-github-delivery")).toBe(false);
    expect(isSensitiveHeader("user-agent")).toBe(false);
    const headers = redactHeaders(
      [
        { name: "content-type", value: "application/json" },
        { name: "X-GitHub-Event", value: "push" },
        { name: "Authorization", value: "Bearer super-secret-token" },
      ],
      false,
    );
    expect(headers[0]?.value).toBe("application/json");
    expect(headers[1]?.value).toBe("push");
    expect(headers[2]?.value).toBe("Bear…oken");
  });

  it("can reveal the original values", () => {
    const headers = redactHeaders([{ name: "cookie", value: "session=abcdef123456" }], true);
    expect(headers[0]?.value).toBe("session=abcdef123456");
  });
});
