import { getEvent } from "@/lib/capture";
import { requireEndpoint } from "@/lib/endpoints";
import { HttpError, errorResponse, json, readJson } from "@/lib/http";
import { recordForward } from "@/lib/replay";
import { forwardReportSchema, parseSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; eventId: string }> };

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, eventId } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const event = await getEvent(endpoint.id, eventId);
    if (!event) return json({ error: "Request not found." }, 404);
    const body = parseSchema(forwardReportSchema, await readJson(req));
    let target: URL;
    try {
      target = new URL(body.targetUrl);
    } catch {
      throw new HttpError(400, "Enter a valid http or https URL.");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new HttpError(400, "Only http and https targets can be recorded.");
    }
    const method = body.method.toUpperCase();
    if (!METHODS.has(method)) throw new HttpError(400, "Unsupported method.");
    const responseBody = Buffer.from(body.responseBody ?? "", "utf8");
    const replay = await recordForward({
      event,
      targetUrl: body.targetUrl,
      method,
      responseStatus: body.responseStatus,
      responseHeaders: body.responseHeaders ?? [],
      responseBody,
      responseTruncated: body.responseTruncated ?? false,
      latencyMs: body.latencyMs,
      error: body.error,
    });
    return json({ replay }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
