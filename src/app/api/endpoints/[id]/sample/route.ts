import { requireEndpoint } from "@/lib/endpoints";
import { errorResponse, json, readJson } from "@/lib/http";
import { consumeRate } from "@/lib/rate-limit";
import { sendSample } from "@/lib/sample";
import { parseSchema, sampleSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const limit = await consumeRate(`sample:${endpoint.id}`, 30, 60_000);
    if (!limit.ok) {
      return json({ error: "Too many sample events. Wait a minute." }, 429, {
        "retry-after": String(limit.retryAfterSec),
      });
    }
    const body = parseSchema(sampleSchema, await readJson(req));
    const result = await sendSample(endpoint, body.provider);
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
