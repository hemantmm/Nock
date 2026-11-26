import { describe, expect, it } from "vitest";
import { toCurl } from "../../src/lib/curl";

describe("cURL export", () => {
  it("builds a replayable command and redacts secrets", () => {
    const command = toCurl({
      method: "post",
      url: "https://example.com/h/ep_123?x=1",
      headers: [
        { name: "Host", value: "example.com" },
        { name: "Content-Type", value: "application/json" },
        { name: "Authorization", value: "Bearer super-secret-token" },
        { name: "Content-Length", value: "12" },
      ],
      body: `{"a":"b'c"}`,
      redact: true,
    });

    expect(command.startsWith("curl -X POST 'https://example.com/h/ep_123?x=1'")).toBe(true);
    expect(command).toContain("-H 'Content-Type: application/json'");
    expect(command).toContain("-H 'Authorization: Bear…oken'");
    expect(command).not.toContain("super-secret-token");
    expect(command).not.toContain("Host:");
    expect(command).not.toContain("Content-Length");
    expect(command).toContain(`--data-binary '{"a":"b'\\''c"}'`);
  });

  it("includes the raw secret when redaction is off", () => {
    const command = toCurl({
      method: "POST",
      url: "https://hooks.example/github",
      headers: [{ name: "X-Hub-Signature-256", value: "sha256=757107ea0eb2509fc211221cce984b8a" }],
      body: "Hello, World!",
      redact: false,
    });
    expect(command).toContain("sha256=757107ea0eb2509fc211221cce984b8a");
    expect(command).toContain("--data-binary 'Hello, World!'");
  });

  it("exports binary bodies as base64", () => {
    const command = toCurl({
      method: "PUT",
      url: "https://example.com/upload",
      headers: [],
      binary: true,
      bodyBase64: "AP8=",
    });
    expect(command).toContain("--data-binary @<(base64 -d <<< 'AP8=')");
  });
});
