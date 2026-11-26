import {
  presentEndpoint,
  requireEndpoint,
  signingSettingsChanged,
  updateEndpoint,
} from "@/lib/endpoints";
import { reverifyRecentEvents } from "@/lib/capture";
import { prisma } from "@/lib/db";
import { errorResponse, json, readJson } from "@/lib/http";
import { parseSchema, updateEndpointSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const url = new URL(req.url);
    return json(presentEndpoint(endpoint, { includeSecret: url.searchParams.get("includeSecret") === "1" }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const update = parseSchema(updateEndpointSchema, await readJson(req));
    if (update.signingSecret === "") update.signingSecret = null;
    const saved = await updateEndpoint(endpoint, update);
    if (signingSettingsChanged(update)) await reverifyRecentEvents(saved);
    return json(presentEndpoint(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    await prisma.endpoint.delete({ where: { id: endpoint.id } });
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
