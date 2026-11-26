import { listEvents } from "@/lib/capture";
import { requireEndpoint } from "@/lib/endpoints";
import { prisma } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
import { listEventsSchema, parseSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const url = new URL(req.url);
    const query = parseSchema(listEventsSchema, {
      method: url.searchParams.get("method") || undefined,
      status: url.searchParams.get("status") || undefined,
      verification: url.searchParams.get("verification") || undefined,
      q: url.searchParams.get("q") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
    });
    const page = await listEvents(endpoint.id, query);
    return json(page);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const result = await prisma.event.deleteMany({ where: { endpointId: endpoint.id } });
    return json({ deleted: result.count });
  } catch (error) {
    return errorResponse(error);
  }
}
