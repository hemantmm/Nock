import { listAlerts } from "@/lib/alerts";
import { requireEndpoint } from "@/lib/endpoints";
import { prisma } from "@/lib/db";
import { errorResponse, json, readJson } from "@/lib/http";
import { z } from "zod";
import { parseSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    return json(await listAlerts(endpoint.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const body = parseSchema(z.object({ alertId: z.string().max(100).optional(), all: z.boolean().optional() }), await readJson(req));
    if (!body.alertId && !body.all) return json({ error: "Choose an alert to mark as read." }, 400);
    const result = await prisma.alert.updateMany({
      where: { endpointId: endpoint.id, readAt: null, ...(body.alertId ? { id: body.alertId } : {}) },
      data: { readAt: new Date() },
    });
    return json({ updated: result.count, ...(await listAlerts(endpoint.id)) });
  } catch (error) {
    return errorResponse(error);
  }
}
