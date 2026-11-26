import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { POST as createEndpointRoute } from "../../src/app/api/endpoints/route";
import { PATCH as updateEndpointRoute } from "../../src/app/api/endpoints/[id]/route";
import { GET as listEventsRoute } from "../../src/app/api/endpoints/[id]/events/route";
import { GET as getEventRoute } from "../../src/app/api/endpoints/[id]/events/[eventId]/route";
import { POST as replayRoute } from "../../src/app/api/endpoints/[id]/events/[eventId]/replay/route";
import { POST as ingest } from "../../src/app/h/[endpointId]/[[...path]]/route";
import { cleanupExpiredEvents } from "../../src/lib/cleanup";
import { prisma } from "../../src/lib/db";
import { resetRateLimits } from "../../src/lib/rate-limit";

type Created = { id: string; token: string };

async function createEndpoint(name: string): Promise<Created> {
  const response = await createEndpointRoute(
    new Request("http://localhost/api/endpoints", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify({ name }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Created;
}

function authed(url: string, token: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(url, { ...init, headers });
}

describe("ingestion and replay", () => {
  beforeAll(async () => {
    await prisma.endpoint.deleteMany({ where: { name: { startsWith: "test-" } } });
  });

  beforeEach(() => {
    resetRateLimits();
  });

  afterAll(async () => {
    await prisma.endpoint.deleteMany({ where: { name: { startsWith: "test-" } } });
    await prisma.$disconnect();
  });

  it("captures the raw request, hides it from strangers, and finds it in search", async () => {
    const created = await createEndpoint("test-capture");
    const body = '{"id":"evt_test_webhook","object":"event","note":"  keep spaces  "}';
    const response = await ingest(
      new Request(`http://localhost/h/${created.id}/stripe/hooks?source=test&source=again`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.20, 10.0.0.1",
          "x-request-id": "req_capture",
          authorization: "Bearer super-secret-token",
        },
        body,
      }),
      { params: Promise.resolve({ endpointId: created.id, path: ["stripe", "hooks"] }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    const eventId = response.headers.get("x-hooktrace-event");
    expect(eventId).toBeTruthy();

    const stranger = await listEventsRoute(
      authed(`http://localhost/api/endpoints/${created.id}/events`, "not-the-token"),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(stranger.status).toBe(404);

    const detailResponse = await getEventRoute(
      authed(`http://localhost/api/endpoints/${created.id}/events/${eventId}`, created.token),
      { params: Promise.resolve({ id: created.id, eventId: eventId! }) },
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      method: string;
      path: string;
      query: { name: string; value: string }[];
      bodyText: string;
      sourceIp: string;
      headers: { name: string; value: string }[];
    };
    expect(detail.method).toBe("POST");
    expect(detail.path).toBe(`/h/${created.id}/stripe/hooks`);
    expect(detail.bodyText).toBe(body);
    expect(detail.sourceIp).toBe("198.51.100.20");
    expect(detail.query).toEqual([
      { name: "source", value: "test" },
      { name: "source", value: "again" },
    ]);
    expect(detail.headers.find((header) => header.name === "authorization")?.value).toBe(
      "Bearer super-secret-token",
    );

    const found = await listEventsRoute(
      authed(`http://localhost/api/endpoints/${created.id}/events?q=${encodeURIComponent("keep spaces")}`, created.token),
      { params: Promise.resolve({ id: created.id }) },
    );
    const page = (await found.json()) as { events: { id: string }[] };
    expect(page.events.map((event) => event.id)).toContain(eventId);

    const missed = await listEventsRoute(
      authed(`http://localhost/api/endpoints/${created.id}/events?method=PUT`, created.token),
      { params: Promise.resolve({ id: created.id }) },
    );
    const empty = (await missed.json()) as { events: unknown[] };
    expect(empty.events).toHaveLength(0);
  });

  it("returns the configured status and verifies a Stripe signature", async () => {
    const created = await createEndpoint("test-stripe");
    const secret = "whsec_test_secret";
    const updated = await updateEndpointRoute(
      authed(`http://localhost/api/endpoints/${created.id}`, created.token, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          responseStatus: 202,
          responseBody: "accepted",
          responseContentType: "text/plain",
          signingProvider: "stripe",
          signingSecret: secret,
          toleranceSeconds: 300,
        }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(updated.status).toBe(200);

    const payload = '{"id":"evt_live","object":"event"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    const response = await ingest(
      new Request(`http://localhost/h/${created.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature},v0=ignored`,
        },
        body: payload,
      }),
      { params: Promise.resolve({ endpointId: created.id, path: undefined }) },
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("accepted");
    const eventId = response.headers.get("x-hooktrace-event")!;

    const detailResponse = await getEventRoute(
      authed(`http://localhost/api/endpoints/${created.id}/events/${eventId}`, created.token),
      { params: Promise.resolve({ id: created.id, eventId }) },
    );
    const detail = (await detailResponse.json()) as { verification: { status: string; provider: string } };
    expect(detail.verification.status).toBe("valid");
    expect(detail.verification.provider).toBe("stripe");

    const tampered = await ingest(
      new Request(`http://localhost/h/${created.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        body: `${payload}\n`,
      }),
      { params: Promise.resolve({ endpointId: created.id }) },
    );
    const tamperedId = tampered.headers.get("x-hooktrace-event")!;
    const tamperedDetail = (await (
      await getEventRoute(authed(`http://localhost/api/endpoints/${created.id}/events/${tamperedId}`, created.token), {
        params: Promise.resolve({ id: created.id, eventId: tamperedId }),
      })
    ).json()) as { verification: { status: string; reason: string } };
    expect(tamperedDetail.verification.status).toBe("invalid");
    expect(["body_modified", "encoding_mismatch"]).toContain(tamperedDetail.verification.reason);
  });

  it("stores binary bodies and truncates past the configured limit", async () => {
    const created = await createEndpoint("test-binary");
    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x10]);
    const response = await ingest(
      new Request(`http://localhost/h/${created.id}/files`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      }),
      { params: Promise.resolve({ endpointId: created.id, path: ["files"] }) },
    );
    expect(response.status).toBe(200);
    const eventId = response.headers.get("x-hooktrace-event")!;
    const detail = (await (
      await getEventRoute(authed(`http://localhost/api/endpoints/${created.id}/events/${eventId}`, created.token), {
        params: Promise.resolve({ id: created.id, eventId }),
      })
    ).json()) as { bodyText: string | null; bodyBase64: string };
    expect(detail.bodyText).toBeNull();
    expect(Buffer.from(detail.bodyBase64, "base64").equals(bytes)).toBe(true);

    process.env.HOOKTRACE_MAX_BODY_BYTES = "64";
    try {
      const big = Buffer.alloc(200, 7);
      const truncated = await ingest(
        new Request(`http://localhost/h/${created.id}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: big,
        }),
        { params: Promise.resolve({ endpointId: created.id }) },
      );
      expect(truncated.headers.get("x-hooktrace-truncated")).toBe("true");
      const truncatedId = truncated.headers.get("x-hooktrace-event")!;
      const stored = (await (
        await getEventRoute(
          authed(`http://localhost/api/endpoints/${created.id}/events/${truncatedId}`, created.token),
          { params: Promise.resolve({ id: created.id, eventId: truncatedId }) },
        )
      ).json()) as { bodySize: number; bodyTruncated: boolean };
      expect(stored.bodyTruncated).toBe(true);
      expect(stored.bodySize).toBe(64);
    } finally {
      delete process.env.HOOKTRACE_MAX_BODY_BYTES;
    }
  });

  it("rate limits ingestion", async () => {
    const created = await createEndpoint("test-rate");
    process.env.HOOKTRACE_INGEST_LIMIT = "2";
    try {
      const send = () =>
        ingest(new Request(`http://localhost/h/${created.id}`, { method: "POST", body: "{}" }), {
          params: Promise.resolve({ endpointId: created.id }),
        });
      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);
      const blocked = await send();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();
    } finally {
      delete process.env.HOOKTRACE_INGEST_LIMIT;
    }
  });

  it("blocks private replay targets and completes a public-style local replay when allowed", async () => {
    const created = await createEndpoint("test-replay");
    const captured = await ingest(
      new Request(`http://localhost/h/${created.id}`, {
        method: "POST",
        headers: { "content-type": "text/plain", authorization: "Bearer super-secret-token" },
        body: "ping",
      }),
      { params: Promise.resolve({ endpointId: created.id }) },
    );
    const eventId = captured.headers.get("x-hooktrace-event")!;
    const replay = async (targetUrl: string) =>
      replayRoute(
        authed(`http://localhost/api/endpoints/${created.id}/events/${eventId}/replay`, created.token, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetUrl, includeSensitive: false }),
        }),
        { params: Promise.resolve({ id: created.id, eventId }) },
      );

    const blocked = await replay("http://127.0.0.1:9/hook");
    expect(blocked.status).toBe(200);
    const blockedBody = (await blocked.json()) as { replay: { error: string | null; responseStatus: number | null } };
    expect(blockedBody.replay.responseStatus).toBeNull();
    expect(blockedBody.replay.error).toMatch(/private|loopback/i);

    const metadata = await replay("http://169.254.169.254/latest/meta-data");
    const metadataBody = (await metadata.json()) as { replay: { error: string | null } };
    expect(metadataBody.replay.error).toMatch(/link-local|metadata/i);

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const received = Buffer.concat(chunks).toString("utf8");
        const auth = req.headers.authorization ?? "";
        res.writeHead(201, { "content-type": "application/json", "x-echo": "yes" });
        res.end(JSON.stringify({ received, auth, method: req.method }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.env.HOOKTRACE_ALLOW_PRIVATE_TARGETS = "true";
    try {
      const allowed = await replay(`http://127.0.0.1:${port}/echo`);
      const body = (await allowed.json()) as {
        replay: {
          responseStatus: number | null;
          responseBodyText: string | null;
          latencyMs: number | null;
          error: string | null;
          responseHeaders: { name: string; value: string }[];
        };
      };
      expect(body.replay.error).toBeNull();
      expect(body.replay.responseStatus).toBe(201);
      expect(body.replay.latencyMs).toBeGreaterThanOrEqual(0);
      const echoed = JSON.parse(body.replay.responseBodyText ?? "{}") as { received: string; auth: string; method: string };
      expect(echoed.received).toBe("ping");
      expect(echoed.method).toBe("POST");
      expect(echoed.auth).toBe("");
      expect(body.replay.responseHeaders.some((header) => header.name === "x-echo")).toBe(true);
    } finally {
      process.env.HOOKTRACE_ALLOW_PRIVATE_TARGETS = "false";
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("deletes events older than the endpoint retention", async () => {
    const created = await createEndpoint("test-cleanup");
    await updateEndpointRoute(
      authed(`http://localhost/api/endpoints/${created.id}`, created.token, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionDays: 7 }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const response = await ingest(new Request(`http://localhost/h/${created.id}`, { method: "POST", body: "old" }), {
      params: Promise.resolve({ endpointId: created.id }),
    });
    const eventId = response.headers.get("x-hooktrace-event")!;
    await prisma.event.update({
      where: { id: eventId },
      data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });
    const fresh = await ingest(new Request(`http://localhost/h/${created.id}`, { method: "POST", body: "new" }), {
      params: Promise.resolve({ endpointId: created.id }),
    });
    const freshId = fresh.headers.get("x-hooktrace-event")!;
    const result = await cleanupExpiredEvents();
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.event.findUnique({ where: { id: eventId } })).toBeNull();
    expect(await prisma.event.findUnique({ where: { id: freshId } })).not.toBeNull();
  });
});
