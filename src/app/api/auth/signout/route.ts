import { assertCsrf, sessionFromRequest } from "@/lib/auth";
import { clearSessionCookies, jsonWithCookies } from "@/lib/cookies";
import { errorResponse, json } from "@/lib/http";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ error: "Sign in required." }, 401);
    assertCsrf(req, session);
    await prisma.session.delete({ where: { id: session.id } });
    return jsonWithCookies({ signedOut: true }, 200, clearSessionCookies());
  } catch (error) {
    return errorResponse(error);
  }
}
