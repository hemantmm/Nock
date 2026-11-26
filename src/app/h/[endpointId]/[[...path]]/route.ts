import { maxBodyBytes, ingestIpLimit, ingestLimit, ingestWindowMs } from "@/lib/constants";
import { captureRequest } from "@/lib/capture";
import { prisma } from "@/lib/db";
import { isEndpointId } from "@/lib/endpoints";
import { clientIp, readQuery, readRequestHeaders } from "@/lib/headers";
import { errorResponse, readLimitedBody } from "@/lib/http";
import { consumeRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ endpointId: string; path?: string[] }> };

async function ingest(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { endpointId, path } = await context.params;
    const ip = clientIp(req) ?? "unknown";
    const ipLimit = await consumeRate(`ingest-ip:${ip}`, ingestIpLimit(), ingestWindowMs());
    if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSec);

    if (!isEndpointId(endpointId)) {
      return Response.json({ error: "Unknown webhook endpoint." }, { status: 404 });
    }
    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) {
      return Response.json({ error: "Unknown webhook endpoint." }, { status: 404 });
    }

    const endpointLimit = await consumeRate(`ingest:${endpoint.id}`, ingestLimit(), ingestWindowMs());
    if (!endpointLimit.ok) return tooMany(endpointLimit.retryAfterSec);

    const { bytes, truncated } = await readLimitedBody(req, maxBodyBytes());
    const url = new URL(req.url);
    const suffix = path?.length ? `/${path.map(encodePath).join("/")}` : "";
    const event = await captureRequest({
      endpoint,
      method: req.method,
      path: `${url.pathname.startsWith("/h/") ? url.pathname : `/h/${endpoint.id}${suffix}`}`,
      query: readQuery(url),
      headers: readRequestHeaders(req),
      body: bytes,
      truncated,
      contentType: req.headers.get("content-type"),
      sourceIp: clientIp(req),
    });

    const headers = new Headers({
      "cache-control": "no-store",
      "x-hooktrace-event": event.id,
      "x-ratelimit-limit": String(endpointLimit.limit),
      "x-ratelimit-remaining": String(endpointLimit.remaining),
      allow: "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    });
    if (truncated) headers.set("x-hooktrace-truncated", "true");

    const status = endpoint.responseStatus;
    if (req.method === "HEAD" || status === 204 || status === 304) {
      return new Response(null, { status, headers });
    }
    headers.set("content-type", endpoint.responseContentType || "text/plain; charset=utf-8");
    return new Response(endpoint.responseBody, { status, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

function tooMany(retryAfterSec: number): Response {
  return Response.json(
    { error: "Too many requests. Slow down and retry." },
    { status: 429, headers: { "retry-after": String(retryAfterSec), "cache-control": "no-store" } },
  );
}

function encodePath(segment: string): string {
  return encodeURIComponent(segment);
}

export const GET = ingest;
export const POST = ingest;
export const PUT = ingest;
export const PATCH = ingest;
export const DELETE = ingest;
export const HEAD = ingest;
export const OPTIONS = ingest;
