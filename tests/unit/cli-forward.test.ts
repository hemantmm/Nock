import http from "node:http";
import { describe, expect, it } from "vitest";
import { parseArgs, parseEndpointRef } from "../../cli/src/args";
import { forwardRequest } from "../../cli/src/forward";
import { createSseParser, nextBackoff } from "../../cli/src/sse";
import { forwardHeaders, localTargetUrl, resolveForwardBase } from "../../cli/src/target";

describe("CLI target URLs and headers", () => {
  it("appends the path after the endpoint id and keeps the query", () => {
    const url = localTargetUrl(
      "http://localhost:3000/webhooks",
      "/h/ep_abcdefghijklmnopqrst/stripe/hooks",
      "ep_abcdefghijklmnopqrst",
      [
        { name: "src", value: "cli" },
        { name: "src", value: "again" },
      ],
    );
    expect(url).toBe("http://localhost:3000/webhooks/stripe/hooks?src=cli&src=again");
  });

  it("uses the forward base when the capture has no suffix", () => {
    expect(localTargetUrl("http://localhost:3000/webhooks/", "/h/ep_abcdefghijklmnopqrst", "ep_abcdefghijklmnopqrst", [])).toBe(
      "http://localhost:3000/webhooks",
    );
  });

  it("builds the port shorthand and rejects mixing it with --forward", () => {
    expect(resolveForwardBase({ port: 3000, path: "/webhooks" })).toBe("http://localhost:3000/webhooks");
    expect(() => resolveForwardBase({ forward: "http://localhost:3000/webhooks", port: 3000 })).toThrow(/not both/);
  });

  it("drops hop-by-hop headers and keeps signature headers", () => {
    const headers = forwardHeaders([
      { name: "Host", value: "hooktrace.example" },
      { name: "Content-Length", value: "12" },
      { name: "Connection", value: "keep-alive" },
      { name: "Content-Type", value: "application/json" },
      { name: "Stripe-Signature", value: "t=1,v1=abc" },
      { name: "Authorization", value: "Bearer secret" },
    ]);
    expect(headers.map((header) => header.name.toLowerCase())).toEqual([
      "content-type",
      "stripe-signature",
      "authorization",
    ]);
  });

  it("parses an endpoint id, a hook URL, and a token in the hash", () => {
    expect(parseEndpointRef("ep_abcdefghijklmnopqrst").endpointId).toBe("ep_abcdefghijklmnopqrst");
    const parsed = parseEndpointRef("http://127.0.0.1:4317/inbox/ep_abcdefghijklmnopqrst#t=owner-token");
    expect(parsed).toEqual({
      endpointId: "ep_abcdefghijklmnopqrst",
      server: "http://127.0.0.1:4317",
      token: "owner-token",
    });
    const command = parseArgs([
      "listen",
      "ep_abcdefghijklmnopqrst",
      "--port",
      "3000",
      "--path",
      "/webhooks",
      "--json",
    ]);
    expect(command).toMatchObject({ command: "listen", port: 3000, path: "/webhooks", json: true });
  });

  it("parses SSE frames, including comments and ids", () => {
    const messages: { id?: string; data: string }[] = [];
    const parser = createSseParser((message) => messages.push(message));
    parser.push(": ping\n");
    parser.push("id: evt_1\ndata: {\"type\":\"event\"}\n\n");
    parser.push("data: {\"type\":\"hello\"}\n\n");
    expect(messages).toEqual([
      { id: "evt_1", data: '{"type":"event"}' },
      { data: '{"type":"hello"}' },
    ]);
    expect(nextBackoff(0)).toBe(500);
    expect(nextBackoff(500)).toBe(1000);
    expect(nextBackoff(10_000)).toBe(15_000);
  });
});

describe("CLI raw body forwarding", () => {
  it("sends the original bytes and omits hop-by-hop headers", async () => {
    const body = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x20, 0x31, 0x7d, 0x00, 0xff, 0x0a]);
    const received: { body: Buffer; headers: http.IncomingHttpHeaders; method?: string; url?: string }[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        received.push({
          body: Buffer.concat(chunks),
          headers: req.headers,
          method: req.method,
          url: req.url,
        });
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const result = await forwardRequest({
        targetUrl: `http://127.0.0.1:${port}/webhooks/stripe?src=cli`,
        method: "POST",
        headers: [
          { name: "Host", value: "upstream.example" },
          { name: "Content-Length", value: "999" },
          { name: "Connection", value: "close" },
          { name: "Content-Type", value: "application/json" },
          { name: "Stripe-Signature", value: "t=1,v1=abc" },
        ],
        body,
      });
      expect(result.responseStatus).toBe(204);
      expect(received).toHaveLength(1);
      expect(received[0]?.method).toBe("POST");
      expect(received[0]?.url).toBe("/webhooks/stripe?src=cli");
      expect(received[0]?.body.equals(body)).toBe(true);
      expect(received[0]?.headers["stripe-signature"]).toBe("t=1,v1=abc");
      expect(received[0]?.headers["content-type"]).toBe("application/json");
      expect(received[0]?.headers.host).toBe(`127.0.0.1:${port}`);
      expect(received[0]?.headers["content-length"]).toBe(String(body.length));
      expect(received[0]?.headers.connection).not.toBe("close");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
