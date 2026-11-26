import { fetchEvent, fetchEventById, reportForward } from "./api.js";
import { createSseParser, nextBackoff } from "./sse.js";
import { forwardRequest } from "./forward.js";
import { formatEvent, type PrintedEvent } from "./output.js";
import { localTargetUrl } from "./target.js";
import type { CapturedEvent } from "./target.js";

export type SessionOptions = {
  server: string;
  token: string;
  endpointId: string;
  forwardBase: string;
  json: boolean;
  from: string | null;
  write?: (line: string) => void;
  writeErr?: (line: string) => void;
  onReady?: () => void;
};

export async function deliver(event: CapturedEvent, options: SessionOptions): Promise<PrintedEvent> {
  const targetUrl = localTargetUrl(options.forwardBase, event.path, event.endpointId, event.query);
  const result = await forwardRequest({
    targetUrl,
    method: event.method,
    headers: event.headers,
    body: event.body,
  });
  const text = decodeReportBody(result.responseBody);
  try {
    await reportForward(options.server, options.token, event.endpointId, event.id, {
      targetUrl: result.targetUrl,
      method: result.method,
      responseStatus: result.responseStatus,
      latencyMs: result.latencyMs,
      error: result.error,
      responseBody: text,
      responseTruncated: result.truncated,
      responseHeaders: result.responseHeaders.slice(0, 40),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record the forward.";
    (options.writeErr ?? ((line) => console.error(line)))(`Could not record the forward for ${event.id}: ${message}`);
  }
  const printed: PrintedEvent = {
    time: new Date().toISOString(),
    method: event.method,
    path: targetUrl,
    provider: event.verification?.provider ?? null,
    verification: event.verification?.status ?? "unchecked",
    reason: event.verification?.reason ?? null,
    summary: event.verification?.summary ?? null,
    localStatus: result.responseStatus,
    latencyMs: result.latencyMs,
    target: result.targetUrl,
    error: result.error,
  };
  (options.write ?? ((line) => console.log(line)))(formatEvent(printed, options.json));
  return printed;
}

export async function replayEvent(eventId: string, options: SessionOptions): Promise<PrintedEvent> {
  const event = options.endpointId
    ? await fetchEvent(options.server, options.token, options.endpointId, eventId)
    : await fetchEventById(options.server, options.token, eventId);
  return deliver(event, { ...options, endpointId: event.endpointId });
}

export async function listen(options: SessionOptions, signal: AbortSignal): Promise<void> {
  let cursor = options.from;
  let delay = 0;
  let announced = false;
  const writeErr = options.writeErr ?? ((line: string) => console.error(line));
  while (!signal.aborted) {
    if (delay > 0) {
      writeErr(options.json ? JSON.stringify({ type: "reconnect", delayMs: delay }) : `Reconnecting in ${delay}ms.`);
      await sleep(delay, signal);
      if (signal.aborted) break;
    }
    try {
      await streamOnce(options, cursor, signal, (eventId) => {
        cursor = eventId;
      }, () => {
        if (!announced) {
          announced = true;
          options.onReady?.();
          if (!options.json) {
            (options.write ?? console.log)(
              `Forwarding ${options.endpointId} to ${options.forwardBase}`,
            );
          }
        }
      });
      delay = 500;
    } catch (error) {
      if (signal.aborted || error instanceof FatalStreamError) {
        if (error instanceof FatalStreamError) writeErr(error.message);
        break;
      }
      const message = error instanceof Error ? error.message : "The stream dropped.";
      writeErr(options.json ? JSON.stringify({ type: "error", message }) : message);
      delay = nextBackoff(delay);
    }
  }
}

async function streamOnce(
  options: SessionOptions,
  cursor: string | null,
  signal: AbortSignal,
  onEventId: (id: string) => void,
  onReady: () => void,
): Promise<void> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.token}`,
    accept: "text/event-stream",
  };
  if (cursor) headers["last-event-id"] = cursor;
  const response = await fetch(`${options.server.replace(/\/+$/, "")}/api/endpoints/${options.endpointId}/stream`, {
    headers,
    signal,
  });
  if (response.status === 401 || response.status === 404) {
    throw new FatalStreamError((await response.text()) || "The endpoint or token was rejected.");
  }
  if (!response.ok || !response.body) throw new Error(await response.text());
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let ready = false;
  const seen = new Set<string>();
  let chain = Promise.resolve();
  const parser = createSseParser((message) => {
    let payload: { type?: string; event?: { id?: string }; latestEventId?: string | null };
    try {
      payload = JSON.parse(message.data) as typeof payload;
    } catch {
      return;
    }
    if (payload.type === "hello") {
      if (!cursor && payload.latestEventId) onEventId(payload.latestEventId);
      if (!ready) {
        ready = true;
        onReady();
      }
      return;
    }
    if (payload.type !== "event" || !payload.event?.id) return;
    const eventId = message.id || payload.event.id;
    if (seen.has(eventId)) return;
    seen.add(eventId);
    chain = chain.then(() => handle(eventId));
  });

  const handle = async (eventId: string) => {
    try {
      const event = await fetchEvent(options.server, options.token, options.endpointId, eventId);
      await deliver(event, options);
      onEventId(eventId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not forward the event.";
      (options.writeErr ?? ((line: string) => console.error(line)))(`${eventId}: ${message}`);
    }
  };

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  await chain;
  if (!signal.aborted) throw new Error("The event stream closed.");
}

class FatalStreamError extends Error {}

function decodeReportBody(body: Buffer): string | null {
  if (body.length === 0) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) {
      clearTimeout(timer);
      resolve();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
