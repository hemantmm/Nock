import { authenticatePassword, createApiToken } from "@/lib/auth";
import { clientIp } from "@/lib/headers";
import { HttpError, errorResponse, json, readJson } from "@/lib/http";
import { consumeRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const ip = clientIp(req) ?? "unknown";
    const limit = await consumeRate(`cli-login:${ip}`, 10, 15 * 60 * 1000);
    if (!limit.ok) return json({ error: "Too many login attempts. Try again later." }, 429);
    const body = (await readJson(req)) as { email?: string; password?: string; name?: string };
    if (!body.email || !body.password) throw new HttpError(400, "Email and password are required.");
    const user = await authenticatePassword(body.email, body.password);
    const created = await createApiToken(user.id, body.name || "CLI");
    return json({ id: created.id, token: created.token, preview: created.preview, email: user.email }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
