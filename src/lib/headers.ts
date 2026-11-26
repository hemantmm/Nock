import type { HeaderPair } from "./types";

export function headerValue(headers: HeaderPair[], name: string): string | null {
  const found = headers.find((header) => header.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : null;
}

export function readRequestHeaders(req: Request): HeaderPair[] {
  const headers: HeaderPair[] = [];
  req.headers.forEach((value, name) => {
    if (name.toLowerCase() === "cookie") return;
    headers.push({ name, value });
  });
  const setCookies = req.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    headers.push({ name: "set-cookie", value: cookie });
  }
  const cookie = req.headers.get("cookie");
  if (cookie) headers.push({ name: "cookie", value: cookie });
  return headers;
}

export function readQuery(url: URL): HeaderPair[] {
  return [...url.searchParams.entries()].map(([name, value]) => ({ name, value }));
}

export function headersText(headers: HeaderPair[]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 80);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 80);
  return null;
}

const HOP_BY_HOP = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function isHopByHop(name: string): boolean {
  return HOP_BY_HOP.has(name.toLowerCase());
}

export function parseHeaderLines(text: string): HeaderPair[] {
  const headers: HeaderPair[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!name) continue;
    headers.push({ name, value });
  }
  return headers;
}

export function formatHeaderLines(headers: HeaderPair[]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}
