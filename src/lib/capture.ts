import { Prisma, type Endpoint, type Event, type Replay } from "@prisma/client";
import { publish } from "./bus";
import { generateId } from "./crypto";
import { authorizeEndpoint, signingSecretOf } from "./endpoints";
import { prisma } from "./db";
import { headersText } from "./headers";
import { isProvider, isSigningEncoding } from "./providers";
import type { EventDetail, EventSummary, HeaderPair, ReplayView, VerificationResult } from "./types";
import { verifyRequest } from "./verify";
import { decodeUtf8 } from "./verify/diagnose";

export async function captureRequest(input: {
  endpoint: Endpoint;
  method: string;
  path: string;
  query: HeaderPair[];
  headers: HeaderPair[];
  body: Buffer;
  truncated: boolean;
  contentType: string | null;
  sourceIp: string | null;
}): Promise<Event> {
  const bodyText = decodeUtf8(input.body);
  const verification = verifyCaptured(input.endpoint, input.body, input.headers);
  const event = await prisma.event.create({
    data: {
      id: generateId("evt", 12),
      endpointId: input.endpoint.id,
      method: input.method.toUpperCase(),
      path: input.path,
      query: input.query as Prisma.InputJsonValue,
      headers: input.headers as Prisma.InputJsonValue,
      headersText: headersText(input.headers),
      body: new Uint8Array(input.body),
      bodyText,
      bodySize: input.body.length,
      bodyTruncated: input.truncated,
      contentType: input.contentType,
      sourceIp: input.sourceIp,
      responseStatus: input.endpoint.responseStatus,
      verificationStatus: verification?.status ?? null,
      verification: verification ? (verification as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
  publish(input.endpoint.id, { type: "event", event: toSummary(event) });
  return event;
}

export function verifyCaptured(
  endpoint: Endpoint,
  body: Buffer,
  headers: HeaderPair[],
): VerificationResult | null {
  if (!isProvider(endpoint.signingProvider)) return null;
  const loaded = signingSecretOf(endpoint);
  if (loaded.error) {
    return {
      status: "invalid",
      provider: endpoint.signingProvider,
      reason: "secret_unavailable",
      summary: "The saved signing secret could not be decrypted.",
      detail:
        "HOOKTRACE_ENCRYPTION_KEY does not match the key that encrypted this secret. Save the secret again, or restore the original encryption key.",
      checks: [
        {
          id: "secret",
          label: "Signing secret",
          state: "fail",
          detail: "Decryption failed.",
        },
      ],
    };
  }
  return verifyRequest({
    provider: endpoint.signingProvider,
    secret: loaded.secret ?? "",
    body,
    headers,
    toleranceSeconds: endpoint.toleranceSeconds,
    signingHeader: endpoint.signingHeader,
    signingEncoding: isSigningEncoding(endpoint.signingEncoding) ? endpoint.signingEncoding : "hex",
    timestampHeader: endpoint.timestampHeader,
  });
}

export async function reverifyRecentEvents(endpoint: Endpoint): Promise<void> {
  const events = await prisma.event.findMany({
    where: { endpointId: endpoint.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  for (const event of events) {
    const verification = verifyCaptured(endpoint, Buffer.from(event.body), asPairs(event.headers));
    await prisma.event.update({
      where: { id: event.id },
      data: {
        verificationStatus: verification?.status ?? null,
        verification: verification ? (verification as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  }
  publish(endpoint.id, { type: "refresh" });
}

export async function listEvents(
  endpointId: string,
  query: {
    method?: string;
    status?: number;
    verification?: "valid" | "invalid" | "none";
    q?: string;
    from?: string;
    to?: string;
    cursor?: string;
  },
): Promise<{ events: EventSummary[]; nextCursor: string | null }> {
  const and: Prisma.EventWhereInput[] = [{ endpointId }];
  if (query.method && query.method !== "ALL") and.push({ method: query.method.toUpperCase() });
  if (query.status) and.push({ responseStatus: query.status });
  if (query.verification === "valid" || query.verification === "invalid") {
    and.push({ verificationStatus: query.verification });
  }
  if (query.verification === "none") and.push({ verificationStatus: null });
  if (query.from) and.push({ createdAt: { gte: new Date(query.from) } });
  if (query.to) and.push({ createdAt: { lte: new Date(query.to) } });
  if (query.q?.trim()) {
    const q = query.q.trim();
    and.push({
      OR: [
        { bodyText: { contains: q, mode: "insensitive" } },
        { headersText: { contains: q, mode: "insensitive" } },
        { path: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    and.push({
      OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
    });
  }

  const rows = await prisma.event.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
  });
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  const nextCursor = rows.length > 50 && last ? encodeCursor(last.createdAt, last.id) : null;
  return { events: page.map(toSummary), nextCursor };
}

export async function getEvent(endpointId: string, eventId: string): Promise<(Event & { replays: Replay[] }) | null> {
  return prisma.event.findFirst({
    where: { id: eventId, endpointId },
    include: { replays: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
}

export async function getOwnedEvent(req: Request, eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { endpoint: true, replays: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!event) return null;
  const allowed = await authorizeEndpoint(req, event.endpoint);
  if (!allowed) return null;
  return event;
}

export async function latestEventId(endpointId: string): Promise<string | null> {
  const row = await prisma.event.findFirst({
    where: { endpointId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function listEventsAfter(endpointId: string, afterEventId: string): Promise<Event[]> {
  const cursor = await prisma.event.findFirst({ where: { id: afterEventId, endpointId } });
  if (!cursor) return [];
  return prisma.event.findMany({
    where: {
      endpointId,
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
}

export function toSummary(event: Event): EventSummary {
  const verification = asVerification(event.verification);
  return {
    id: event.id,
    method: event.method,
    path: event.path,
    query: asPairs(event.query),
    contentType: event.contentType,
    bodyPreview: preview(event.bodyText, event.bodyTruncated, event.bodySize),
    bodySize: event.bodySize,
    bodyTruncated: event.bodyTruncated,
    sourceIp: event.sourceIp,
    responseStatus: event.responseStatus,
    verification,
    createdAt: event.createdAt.toISOString(),
  };
}

export function toDetail(event: Event & { replays: Replay[] }): EventDetail {
  const body = Buffer.from(event.body);
  return {
    ...toSummary(event),
    headers: asPairs(event.headers),
    bodyText: event.bodyText,
    bodyBase64: body.toString("base64"),
    replays: event.replays.map(toReplay),
  };
}

export function toReplay(replay: Replay): ReplayView {
  const responseBody = replay.responseBody ? Buffer.from(replay.responseBody) : null;
  return {
    id: replay.id,
    targetUrl: replay.targetUrl,
    method: replay.method,
    requestHeaders: asPairs(replay.requestHeaders),
    responseStatus: replay.responseStatus,
    responseHeaders: asPairs(replay.responseHeaders),
    responseBodyText: responseBody ? decodeUtf8(responseBody) : null,
    responseTruncated: replay.responseTruncated,
    latencyMs: replay.latencyMs,
    error: replay.error,
    source: replay.source === "forward" ? "forward" : "replay",
    createdAt: replay.createdAt.toISOString(),
  };
}

function preview(text: string | null, truncated: boolean, size: number): string {
  if (size === 0) return "";
  if (text === null) return truncated ? "Binary body, truncated" : "Binary body";
  const slice = text.slice(0, 180);
  return text.length > 180 || truncated ? `${slice}…` : slice;
}

export function asPairs(value: unknown): HeaderPair[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const name = "name" in item ? item.name : null;
    const headerValue = "value" in item ? item.value : null;
    if (typeof name !== "string" || typeof headerValue !== "string") return [];
    return [{ name, value: headerValue }];
  });
}

export function asVerification(value: unknown): VerificationResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<VerificationResult>;
  if (record.status !== "valid" && record.status !== "invalid") return null;
  if (!record.provider || !record.reason || !record.summary || !record.detail) return null;
  if (!Array.isArray(record.checks)) return null;
  return record as VerificationResult;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const split = decoded.indexOf("|");
    if (split <= 0) return null;
    const createdAt = new Date(decoded.slice(0, split));
    const id = decoded.slice(split + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
