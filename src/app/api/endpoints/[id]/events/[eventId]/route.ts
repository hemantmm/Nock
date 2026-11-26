import { getEvent, toDetail } from "@/lib/capture";
import { requireEndpoint } from "@/lib/endpoints";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; eventId: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, eventId } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const event = await getEvent(endpoint.id, eventId);
    if (!event) return json({ error: "Request not found." }, 404);
    return json(toDetail(event));
  } catch (error) {
    return errorResponse(error);
  }
}
