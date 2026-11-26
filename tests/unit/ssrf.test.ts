import { describe, expect, it } from "vitest";
import { allowPrivateTargets } from "../../src/lib/constants";
import { assertReplayTarget, classifyIp, SsrfError } from "../../src/lib/ssrf";

describe("SSRF guard", () => {
  it("classifies public, private, loopback, and link-local addresses", () => {
    expect(classifyIp("8.8.8.8").blocked).toBe(false);
    expect(classifyIp("172.15.255.255").blocked).toBe(false);
    expect(classifyIp("172.32.0.1").blocked).toBe(false);
    expect(classifyIp("1.1.1.1").kind).toBe("public");

    expect(classifyIp("127.0.0.1").blocked).toBe(true);
    expect(classifyIp("10.1.2.3").blocked).toBe(true);
    expect(classifyIp("192.168.1.20").blocked).toBe(true);
    expect(classifyIp("172.16.0.1").blocked).toBe(true);
    expect(classifyIp("100.64.0.5").kind).toBe("private");
    expect(classifyIp("::1").blocked).toBe(true);
    expect(classifyIp("fd00::1").blocked).toBe(true);
    expect(classifyIp("::ffff:127.0.0.1").blocked).toBe(true);
    expect(classifyIp("::ffff:8.8.8.8").blocked).toBe(false);

    expect(classifyIp("169.254.169.254", { allowPrivate: true }).blocked).toBe(true);
    expect(classifyIp("fe80::1", { allowPrivate: true }).blocked).toBe(true);
    expect(classifyIp("0.0.0.0", { allowPrivate: true }).blocked).toBe(true);
    expect(classifyIp("127.0.0.1", { allowPrivate: true }).blocked).toBe(false);
    expect(classifyIp("10.0.0.8", { allowPrivate: true }).blocked).toBe(false);
  });

  it("rejects non-http, credentialed, numeric, and local hosts before DNS", async () => {
    await expect(assertReplayTarget("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertReplayTarget("http://user:pass@example.com/hook")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertReplayTarget("http://2130706433/")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertReplayTarget("http://localhost/hook")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertReplayTarget("http://metadata.google.internal/")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertReplayTarget("http://127.0.0.1:3000/webhooks")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertReplayTarget("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertReplayTarget("http://8.8.8.8/dns")).resolves.toBeInstanceOf(URL);
    expect(allowPrivateTargets()).toBe(false);
  });
});
