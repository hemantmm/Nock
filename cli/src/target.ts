export type HeaderPair = { name: string; value: string };

export type VerificationSnapshot = {
  status: "valid" | "invalid";
  provider: string;
  reason: string;
  summary: string;
} | null;

export type CapturedEvent = {
  id: string;
  endpointId: string;
  method: string;
  path: string;
  query: HeaderPair[];
  headers: HeaderPair[];
  body: Buffer;
  verification: VerificationSnapshot;
};

export type ForwardResult = {
  targetUrl: string;
  method: string;
  responseStatus: number | null;
  responseHeaders: HeaderPair[];
  responseBody: Buffer;
  latencyMs: number;
  error: string | null;
  truncated: boolean;
};

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

export function forwardHeaders(headers: HeaderPair[]): HeaderPair[] {
  return headers.filter((header) => header.name.trim() && !isHopByHop(header.name));
}

export function localTargetUrl(
  forwardBase: string,
  eventPath: string,
  endpointId: string,
  query: HeaderPair[],
): string {
  const base = new URL(forwardBase);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("The forward target must be an http or https URL.");
  }
  const marker = `/h/${endpointId}`;
  const at = eventPath.indexOf(marker);
  const suffix = at >= 0 ? eventPath.slice(at + marker.length) : "";
  const basePath = base.pathname.replace(/\/+$/, "");
  const extra = suffix ? (suffix.startsWith("/") ? suffix : `/${suffix}`) : "";
  base.pathname = `${basePath}${extra}` || "/";
  base.search = "";
  const params = new URLSearchParams();
  for (const pair of query) params.append(pair.name, pair.value);
  const search = params.toString();
  if (search) base.search = `?${search}`;
  return base.toString();
}

export function resolveForwardBase(input: { forward?: string; port?: number; path?: string }): string {
  if (input.forward && (input.port !== undefined || input.path !== undefined)) {
    throw new Error("Use either --forward or --port/--path, not both.");
  }
  if (input.forward) {
    const url = new URL(input.forward);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("--forward must be an http or https URL.");
    }
    return url.toString();
  }
  if (input.port === undefined) throw new Error("Pass --forward, or --port with an optional --path.");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("--port must be a TCP port.");
  }
  const path = input.path && input.path.length > 0 ? input.path : "/";
  const pathname = path.startsWith("/") ? path : `/${path}`;
  return new URL(`http://localhost:${input.port}${pathname}`).toString();
}
