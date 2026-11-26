import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Prisma, type Event } from "@prisma/client";
import { publish } from "./bus";
import { generateId } from "./crypto";
import { prisma } from "./db";
import { isHopByHop } from "./headers";
import { isSensitiveHeader } from "./redact";
import { assertReplayTarget, ipAllowedAtConnect, SsrfError } from "./ssrf";
import type { HeaderPair } from "./types";
import { asPairs, toReplay } from "./capture";
import type { ReplayView } from "./types";

const REPLAY_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const RESPONSE_LIMIT = 1_048_576;

export async function replayCapturedEvent(input: {
  event: Event;
  targetUrl: string;
  method?: string;
  headers?: HeaderPair[];
  body?: string;
  includeSensitive?: boolean;
}): Promise<ReplayView> {
  const method = (input.method || input.event.method || "POST").toUpperCase();
  if (!REPLAY_METHODS.has(method)) {
    throw new SsrfError("Replay supports GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS.");
  }

  const sourceHeaders = input.headers ?? asPairs(input.event.headers);
  const headers = sourceHeaders.filter((header) => {
    if (isHopByHop(header.name)) return false;
    if (!input.headers && !input.includeSensitive && isSensitiveHeader(header.name)) return false;
    return true;
  });
  const body = method === "GET" || method === "HEAD"
    ? Buffer.alloc(0)
    : input.body !== undefined
      ? Buffer.from(input.body, "utf8")
      : Buffer.from(input.event.body);

  let outcome: ReplayOutcome;
  try {
    await assertReplayTarget(input.targetUrl);
    outcome = await performReplay({ url: input.targetUrl, method, headers, body });
  } catch (error) {
    outcome = {
      responseStatus: null,
      responseHeaders: [],
      responseBody: Buffer.alloc(0),
      responseTruncated: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : "Replay failed.",
    };
  }

  const replay = await prisma.replay.create({
    data: {
      id: generateId("rpl", 12),
      eventId: input.event.id,
      targetUrl: input.targetUrl,
      method,
      requestHeaders: headers as Prisma.InputJsonValue,
      requestBody: new Uint8Array(body),
      responseStatus: outcome.responseStatus,
      responseHeaders: outcome.responseHeaders as Prisma.InputJsonValue,
      responseBody: new Uint8Array(outcome.responseBody),
      responseTruncated: outcome.responseTruncated,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
    },
  });
  return toReplay(replay);
}

export async function recordForward(input: {
  event: Event;
  targetUrl: string;
  method: string;
  responseStatus: number | null;
  responseHeaders: HeaderPair[];
  responseBody: Buffer;
  responseTruncated: boolean;
  latencyMs: number;
  error: string | null;
}): Promise<ReplayView> {
  const replay = await prisma.replay.create({
    data: {
      id: generateId("rpl", 12),
      eventId: input.event.id,
      targetUrl: input.targetUrl,
      method: input.method.toUpperCase(),
      requestHeaders: asPairs(input.event.headers) as Prisma.InputJsonValue,
      requestBody: new Uint8Array(Buffer.from(input.event.body)),
      responseStatus: input.responseStatus,
      responseHeaders: input.responseHeaders as Prisma.InputJsonValue,
      responseBody: new Uint8Array(input.responseBody),
      responseTruncated: input.responseTruncated,
      latencyMs: input.latencyMs,
      error: input.error,
      source: "forward",
    },
  });
  publish(input.event.endpointId, { type: "refresh" });
  return toReplay(replay);
}

type ReplayOutcome = {
  responseStatus: number | null;
  responseHeaders: HeaderPair[];
  responseBody: Buffer;
  responseTruncated: boolean;
  latencyMs: number;
  error: string | null;
};

export async function performReplay(input: {
  url: string;
  method: string;
  headers: HeaderPair[];
  body: Buffer;
}): Promise<ReplayOutcome> {
  const url = await assertReplayTarget(input.url);
  const started = Date.now();
  const lib = url.protocol === "https:" ? https : http;
  const headers: http.OutgoingHttpHeaders = {};
  for (const header of input.headers) {
    if (isHopByHop(header.name)) continue;
    if (!/^[\w-]{1,80}$/.test(header.name)) continue;
    const current = headers[header.name];
    if (current === undefined) headers[header.name] = header.value;
    else if (Array.isArray(current)) current.push(header.value);
    else headers[header.name] = [String(current), header.value];
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ReplayOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const req = lib.request(
      url,
      {
        method: input.method,
        headers,
        timeout: 15_000,
        lookup: guardedLookup,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const done = () => {
          finish({
            responseStatus: res.statusCode ?? 0,
            responseHeaders: incomingHeaders(res),
            responseBody: Buffer.concat(chunks),
            responseTruncated: truncated,
            latencyMs: Date.now() - started,
            error: null,
          });
        };
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          if (size + chunk.length > RESPONSE_LIMIT) {
            chunks.push(chunk.subarray(0, Math.max(0, RESPONSE_LIMIT - size)));
            size = RESPONSE_LIMIT;
            truncated = true;
            res.destroy();
            done();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        res.on("end", done);
        res.on("error", (error) => finish(networkFailure(started, error)));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("The target did not respond within 15 seconds."));
    });
    req.on("error", (error) => finish(networkFailure(started, error)));
    if (input.body.length > 0 && input.method !== "GET" && input.method !== "HEAD") {
      req.write(input.body);
    }
    req.end();
  });
}

function incomingHeaders(res: http.IncomingMessage): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) pairs.push({ name, value: item });
  }
  return pairs;
}

function networkFailure(started: number, error: unknown): ReplayOutcome {
  const message =
    error instanceof SsrfError
      ? error.message
      : error instanceof Error
        ? error.message.slice(0, 300)
        : "The target request failed.";
  return {
    responseStatus: null,
    responseHeaders: [],
    responseBody: Buffer.alloc(0),
    responseTruncated: false,
    latencyMs: Date.now() - started,
    error: message,
  };
}

function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, "");
      return;
    }
    for (const entry of addresses) {
      if (!ipAllowedAtConnect(entry.address)) {
        const blocked = new SsrfError(
          `${hostname} resolved to a blocked address.`,
        ) as NodeJS.ErrnoException;
        blocked.code = "ESSRF";
        callback(blocked, "");
        return;
      }
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0];
    if (!first) {
      const missing = new Error("DNS lookup returned no addresses.") as NodeJS.ErrnoException;
      missing.code = "ENOTFOUND";
      callback(missing, "");
      return;
    }
    callback(null, first.address, first.family);
  });
}
