import { authenticatePassword, createSession, presentUser } from "@/lib/auth";
import { jsonWithCookies } from "@/lib/cookies";
import { clientIp } from "@/lib/headers";
import { HttpError, errorResponse, json, readJson } from "@/lib/http";
import { consumeRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const ip = clientIp(req) ?? "unknown";
    const limit = consumeRate(`signin:${ip}`, 20, 15 * 60 * 1000);
    if (!limit.ok) return json({ error: "Too many sign-in attempts. Try again later." }, 429);
    const body = (await readJson(req)) as { email?: string; password?: string };
    if (!body.email || !body.password) throw new HttpError(400, "Email and password are required.");
    const user = await authenticatePassword(body.email, body.password);
    const session = await createSession(user.id);
    return jsonWithCookies({ user: presentUser(user), csrfToken: session.csrfToken }, 200, session.cookies);
  } catch (error) {
    return errorResponse(error);
  }
}
