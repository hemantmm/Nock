import { assertCsrf, sessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ error: "Sign in required." }, 401);
    assertCsrf(req, session);
    const { id } = await context.params;
    const token = await prisma.apiToken.findFirst({ where: { id, userId: session.userId, revokedAt: null } });
    if (!token) return json({ error: "Token not found." }, 404);
    await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    return json({ revoked: true });
  } catch (error) {
    return errorResponse(error);
  }
}
