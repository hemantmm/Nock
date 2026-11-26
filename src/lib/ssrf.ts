import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import { allowPrivateTargets } from "./constants";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const ALWAYS_BLOCKED = new BlockList();
ALWAYS_BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS_BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
ALWAYS_BLOCKED.addSubnet("224.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addSubnet("240.0.0.0", 4, "ipv4");
ALWAYS_BLOCKED.addAddress("255.255.255.255", "ipv4");
ALWAYS_BLOCKED.addAddress("::", "ipv6");
ALWAYS_BLOCKED.addSubnet("fe80::", 10, "ipv6");
ALWAYS_BLOCKED.addSubnet("ff00::", 8, "ipv6");
ALWAYS_BLOCKED.addSubnet("2001:db8::", 32, "ipv6");

const PRIVATE = new BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
]);

export type IpVerdict = {
  blocked: boolean;
  kind: "public" | "private" | "link-local" | "reserved" | "invalid";
  reason: string;
};

export function normalizeIp(ip: string): string {
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    if (isIP(mapped) === 4) return mapped;
  }
  return ip;
}

export function classifyIp(ip: string, options?: { allowPrivate?: boolean }): IpVerdict {
  const normalized = normalizeIp(ip.trim());
  const family = isIP(normalized);
  if (!family) {
    return { blocked: true, kind: "invalid", reason: `${ip} is not an IP address.` };
  }
  const version = family === 6 ? "ipv6" : "ipv4";
  if (ALWAYS_BLOCKED.check(normalized, version)) {
    const linkLocal =
      normalized.toLowerCase().startsWith("fe80:") ||
      normalized.startsWith("169.254.") ||
      normalized.toLowerCase() === "::ffff:169.254.169.254";
    return {
      blocked: true,
      kind: linkLocal ? "link-local" : "reserved",
      reason: linkLocal
        ? "Link-local addresses are blocked, including cloud metadata addresses."
        : "Unspecified, multicast, and reserved addresses are blocked.",
    };
  }
  if (PRIVATE.check(normalized, version)) {
    const allowPrivate = options?.allowPrivate ?? false;
    return {
      blocked: !allowPrivate,
      kind: "private",
      reason: allowPrivate
        ? "Private address allowed by HOOKTRACE_ALLOW_PRIVATE_TARGETS."
        : "Private and loopback addresses are blocked. Replay to a public URL, or set HOOKTRACE_ALLOW_PRIVATE_TARGETS=true only on a trusted local server.",
    };
  }
  return { blocked: false, kind: "public", reason: "Public address." };
}

export async function assertReplayTarget(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("Enter a valid http or https URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("Only http and https targets are allowed.");
  }
  if (url.username || url.password) {
    throw new SsrfError("URLs with embedded credentials are blocked.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new SsrfError("The URL is missing a host.");
  if (
    BLOCKED_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new SsrfError(
      "This hostname is blocked. Local, mDNS, and metadata hosts cannot be replay targets.",
    );
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    throw new SsrfError("Numeric hostnames are blocked.");
  }

  const allowPrivate = allowPrivateTargets();
  if (isIP(host)) {
    const verdict = classifyIp(host, { allowPrivate });
    if (verdict.blocked) throw new SsrfError(verdict.reason);
    return url;
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`Could not resolve ${host}.`);
  }
  if (addresses.length === 0) throw new SsrfError(`Could not resolve ${host}.`);
  for (const entry of addresses) {
    const verdict = classifyIp(entry.address, { allowPrivate });
    if (verdict.blocked) {
      throw new SsrfError(`${host} resolves to ${entry.address}. ${verdict.reason}`);
    }
  }
  return url;
}

export function ipAllowedAtConnect(ip: string): boolean {
  return !classifyIp(ip, { allowPrivate: allowPrivateTargets() }).blocked;
}
