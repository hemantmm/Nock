import { getEvent } from "@/lib/capture";
import { requireEndpoint } from "@/lib/endpoints";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; eventId: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, eventId } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return new Response("Not found", { status: 404 });
    const event = await getEvent(endpoint.id, eventId);
    if (!event) return new Response("Not found", { status: 404 });
    const body = Buffer.from(event.body);
    return new Response(body, {
      headers: {
        "content-type": event.contentType || "application/octet-stream",
        "content-disposition": `attachment; filename="${event.id}.bin"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
