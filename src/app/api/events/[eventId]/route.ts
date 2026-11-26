import { getOwnedEvent, toDetail } from "@/lib/capture";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { eventId } = await context.params;
    const event = await getOwnedEvent(req, eventId);
    if (!event) return json({ error: "Request not found." }, 404);
    return json({ endpointId: event.endpointId, event: toDetail(event) });
  } catch (error) {
    return errorResponse(error);
  }
}
