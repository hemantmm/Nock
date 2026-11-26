import { latestEventId, listEventsAfter, toSummary } from "@/lib/capture";
import { subscribe } from "@/lib/bus";
import { requireEndpoint } from "@/lib/endpoints";
import { json } from "@/lib/http";
import type { LiveMessage } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const endpoint = await requireEndpoint(req, id);
  if (!endpoint) return json({ error: "Endpoint not found." }, 404);

  const lastEventId = req.headers.get("last-event-id");
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (idLine: string | null, message: LiveMessage) => {
        const prefix = idLine ? `id: ${idLine}\n` : "";
        controller.enqueue(encoder.encode(`${prefix}data: ${JSON.stringify(message)}\n\n`));
      };

      let replaying = true;
      const queued: LiveMessage[] = [];
      unsubscribe = subscribe(endpoint.id, (message) => {
        if (replaying) queued.push(message);
        else send(message.type === "event" ? message.event.id : null, message);
      });

      try {
        const latest = await latestEventId(endpoint.id);
        send(null, { type: "hello", endpointId: endpoint.id, latestEventId: latest });
        const seen = new Set<string>();
        if (lastEventId) {
          const missed = await listEventsAfter(endpoint.id, lastEventId);
          for (const event of missed) {
            seen.add(event.id);
            send(event.id, { type: "event", event: toSummary(event) });
          }
        }
        replaying = false;
        for (const message of queued.splice(0)) {
          if (message.type === "event" && seen.has(message.event.id)) continue;
          send(message.type === "event" ? message.event.id : null, message);
        }
      } catch {
        replaying = false;
        for (const message of queued.splice(0)) {
          send(message.type === "event" ? message.event.id : null, message);
        }
      }

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // The client is gone.
        }
      }, 15_000);
      req.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
