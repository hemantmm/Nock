import http from "node:http";
import https from "node:https";
import type { ForwardResult, HeaderPair } from "./target.js";
import { forwardHeaders } from "./target.js";

const RESPONSE_LIMIT = 64 * 1024;

export async function forwardRequest(input: {
  targetUrl: string;
  method: string;
  headers: HeaderPair[];
  body: Buffer;
}): Promise<ForwardResult> {
  const url = new URL(input.targetUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return failed(input, "Only http and https targets are supported.");
  }
  const method = input.method.toUpperCase();
  const headers = forwardHeaders(input.headers);
  const lib = url.protocol === "https:" ? https : http;
  const outgoing: http.OutgoingHttpHeaders = {};
  for (const header of headers) {
    if (!/^[\w-]{1,80}$/.test(header.name)) continue;
    const current = outgoing[header.name];
    if (current === undefined) outgoing[header.name] = header.value;
    else if (Array.isArray(current)) current.push(header.value);
    else outgoing[header.name] = [String(current), header.value];
  }

  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ForwardResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = lib.request(
      url,
      { method, headers: outgoing, timeout: 15_000 },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const done = () => {
          const responseHeaders: HeaderPair[] = [];
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            for (const item of Array.isArray(value) ? value : [value]) {
              responseHeaders.push({ name, value: item });
            }
          }
          finish({
            targetUrl: input.targetUrl,
            method,
            responseStatus: res.statusCode ?? null,
            responseHeaders,
            responseBody: Buffer.concat(chunks),
            latencyMs: Date.now() - started,
            error: null,
            truncated,
          });
        };
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          if (size + chunk.length > RESPONSE_LIMIT) {
            chunks.push(chunk.subarray(0, RESPONSE_LIMIT - size));
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
        res.on("error", (error) => finish(failed(input, error.message, Date.now() - started)));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("The local server did not respond within 15 seconds."));
    });
    req.on("error", (error) => finish(failed(input, error.message, Date.now() - started)));
    if (input.body.length > 0 && method !== "GET" && method !== "HEAD") req.end(input.body);
    else req.end();
  });
}

function failed(
  input: { targetUrl: string; method: string },
  error: string,
  latencyMs = 0,
): ForwardResult {
  return {
    targetUrl: input.targetUrl,
    method: input.method.toUpperCase(),
    responseStatus: null,
    responseHeaders: [],
    responseBody: Buffer.alloc(0),
    latencyMs,
    error,
    truncated: false,
  };
}
