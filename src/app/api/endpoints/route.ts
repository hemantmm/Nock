import { assertCsrf, sessionFromRequest, userFromApiToken } from "@/lib/auth";
import { createLimit } from "@/lib/constants";
import { createEndpoint, listOwnedEndpoints, presentEndpoint, readOwnerToken } from "@/lib/endpoints";
import { clientIp } from "@/lib/headers";
import { errorResponse, json, readJson } from "@/lib/http";
import { consumeRate } from "@/lib/rate-limit";
import { createEndpointSchema, parseSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const bearer = readOwnerToken(req);
    const apiUser = bearer?.startsWith("ht_") ? await userFromApiToken(bearer) : null;
    const session = apiUser ? null : await sessionFromRequest(req);
    const userId = apiUser?.id ?? session?.userId;
    if (!userId) return json({ error: "Sign in required." }, 401);
    const endpoints = await listOwnedEndpoints(userId);
    return json({ endpoints: endpoints.map((endpoint) => presentEndpoint(endpoint)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ip = clientIp(req) ?? "unknown";
    const limit = await consumeRate(`create:${ip}`, createLimit(), 60 * 60 * 1000);
    if (!limit.ok) {
      return json(
        { error: "Too many endpoints created from this network. Try again later." },
        429,
        { "retry-after": String(limit.retryAfterSec) },
      );
    }
    const body = parseSchema(createEndpointSchema, await readJson(req));
    const bearer = readOwnerToken(req);
    const apiUser = bearer?.startsWith("ht_") ? await userFromApiToken(bearer) : null;
    const session = apiUser ? null : await sessionFromRequest(req);
    if (session) assertCsrf(req, session);
    const { endpoint, token } = await createEndpoint(body.name, apiUser?.id ?? session?.userId ?? null);
    return json({ ...presentEndpoint(endpoint), token }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
