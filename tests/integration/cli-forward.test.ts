import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createEndpointRoute } from "../../src/app/api/endpoints/route";
import { PATCH as updateEndpointRoute } from "../../src/app/api/endpoints/[id]/route";
import { GET as streamRoute } from "../../src/app/api/endpoints/[id]/stream/route";
import { GET as getEventRoute } from "../../src/app/api/endpoints/[id]/events/[eventId]/route";
import { POST as forwardRoute } from "../../src/app/api/endpoints/[id]/events/[eventId]/forward/route";
import { GET as eventByIdRoute } from "../../src/app/api/events/[eventId]/route";
import { POST as ingestRoute } from "../../src/app/h/[endpointId]/[[...path]]/route";
import { listen } from "../../cli/src/session";
import { prisma } from "../../src/lib/db";
import { resetRateLimits } from "../../src/lib/rate-limit";

async function toRequest(req: http.IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }
  const init: RequestInit & { duplex?: "half" } = { method: req.method, headers };
  if (body.length > 0 && req.method !== "GET" && req.method !== "HEAD") {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(new URL(req.url ?? "/", base), init);
}

async function writeResponse(res: http.ServerResponse, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

async function startApp() {
  const server = http.createServer(async (req, res) => {
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const request = await toRequest(req, base);
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean);
      let response: Response;
      if (req.method === "POST" && url.pathname === "/api/endpoints") {
        response = await createEndpointRoute(request);
      } else if (parts[0] === "api" && parts[1] === "endpoints" && parts[3] === "stream") {
        response = await streamRoute(request, { params: Promise.resolve({ id: parts[2]! }) });
      } else if (parts[0] === "api" && parts[1] === "endpoints" && parts[3] === "events" && parts[5] === "forward") {
        response = await forwardRoute(request, { params: Promise.resolve({ id: parts[2]!, eventId: parts[4]! }) });
      } else if (parts[0] === "api" && parts[1] === "endpoints" && parts[3] === "events" && parts.length === 5) {
        response = await getEventRoute(request, { params: Promise.resolve({ id: parts[2]!, eventId: parts[4]! }) });
      } else if (parts[0] === "api" && parts[1] === "endpoints" && req.method === "PATCH") {
        response = await updateEndpointRoute(request, { params: Promise.resolve({ id: parts[2]! }) });
      } else if (parts[0] === "api" && parts[1] === "events") {
        response = await eventByIdRoute(request, { params: Promise.resolve({ eventId: parts[2]! }) });
      } else if (parts[0] === "h") {
        response = await ingestRoute(request, {
          params: Promise.resolve({ endpointId: parts[1]!, path: parts.slice(2) }),
        });
      } else {
        response = new Response("Not found", { status: 404 });
      }
      await writeResponse(res, response);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.message : "failed");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe("CLI listen forwards a Stripe event", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  afterAll(async () => {
    await prisma.endpoint.deleteMany({ where: { name: "test-cli-forward" } });
    await prisma.$disconnect();
  });

  it("forwards the raw signed body to localhost and records the local response", async () => {
    const app = await startApp();
    const secret = "whsec_test_secret";
    const payload = Buffer.from('{"id":"evt_cli","object":"event","note":"  keep  "}\n');
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(payload).digest("hex");
    const seen: { body: Buffer; valid: boolean; url?: string }[] = [];
    const echo = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const header = String(req.headers["stripe-signature"] ?? "");
        const received = header.split(",").find((part) => part.startsWith("v1="))?.slice(3) ?? "";
        const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
        const actual = Buffer.from(received, "hex");
        const valid = actual.length === expected.length && timingSafeEqual(actual, expected) && body.equals(payload);
        seen.push({ body, valid, url: req.url });
        res.writeHead(valid ? 200 : 400, { "content-type": "text/plain" });
        res.end(valid ? "verified" : "rejected");
      });
    });
    await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
    const echoAddress = echo.address();
    const echoPort = typeof echoAddress === "object" && echoAddress ? echoAddress.port : 0;
    const controller = new AbortController();
    let running: Promise<void> = Promise.resolve();
    try {
      const createdResponse = await fetch(`${app.url}/api/endpoints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "test-cli-forward" }),
      });
      const created = (await createdResponse.json()) as { id: string; token: string };
      await fetch(`${app.url}/api/endpoints/${created.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${created.token}`, "content-type": "application/json" },
        body: JSON.stringify({ signingProvider: "stripe", signingSecret: secret, toleranceSeconds: 300 }),
      });

      let ready = false;
      running = listen(
        {
          server: app.url,
          token: created.token,
          endpointId: created.id,
          forwardBase: `http://127.0.0.1:${echoPort}/webhooks`,
          json: true,
          from: null,
          write: () => undefined,
          writeErr: () => undefined,
          onReady: () => {
            ready = true;
          },
        },
        controller.signal,
      );

      const started = Date.now();
      while (!ready && Date.now() - started < 5_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(ready).toBe(true);

      const sent = await fetch(`${app.url}/h/${created.id}/stripe?src=cli`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
          connection: "close",
        },
        body: payload,
      });
      expect(sent.status).toBe(200);
      const eventId = sent.headers.get("x-hooktrace-event");
      expect(eventId).toBeTruthy();

      const waitStarted = Date.now();
      while (seen.length === 0 && Date.now() - waitStarted < 8_000) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(seen).toHaveLength(1);
      expect(seen[0]?.valid).toBe(true);
      expect(seen[0]?.url).toBe("/webhooks/stripe?src=cli");
      expect(seen[0]?.body.equals(payload)).toBe(true);

      let detail: { replays: { source: string; responseStatus: number; targetUrl: string; latencyMs: number }[] } = {
        replays: [],
      };
      const recordedAt = Date.now();
      while (detail.replays.length === 0 && Date.now() - recordedAt < 8_000) {
        detail = (await (
          await fetch(`${app.url}/api/endpoints/${created.id}/events/${eventId}`, {
            headers: { authorization: `Bearer ${created.token}` },
          })
        ).json()) as typeof detail;
        if (detail.replays.length === 0) await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(detail.replays[0]?.source).toBe("forward");
      expect(detail.replays[0]?.responseStatus).toBe(200);
      expect(detail.replays[0]?.targetUrl).toContain("/webhooks/stripe");
      expect(detail.replays[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      controller.abort();
      await running;
      await new Promise<void>((resolve, reject) => echo.close((error) => (error ? reject(error) : resolve())));
      await new Promise<void>((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
