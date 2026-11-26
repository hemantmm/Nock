import { assertCsrf, sessionFromRequest } from "@/lib/auth";
import { claimEndpoint, presentEndpoint } from "@/lib/endpoints";
import { HttpError, errorResponse, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ error: "Sign in required." }, 401);
    assertCsrf(req, session);
    const body = (await readJson(req)) as { endpointId?: string; ownerToken?: string };
    if (!body.endpointId || !body.ownerToken) throw new HttpError(400, "Endpoint id and owner token are required.");
    const endpoint = await claimEndpoint(session.userId, body.endpointId, body.ownerToken);
    return json({ endpoint: presentEndpoint(endpoint) });
  } catch (error) {
    return errorResponse(error);
  }
}
