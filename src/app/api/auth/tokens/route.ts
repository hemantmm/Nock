import { assertCsrf, createApiToken, sessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ error: "Sign in required." }, 401);
    const tokens = await prisma.apiToken.findMany({
      where: { userId: session.userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return json({
      tokens: tokens.map((token) => ({
        id: token.id,
        name: token.name,
        preview: token.tokenPreview,
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        createdAt: token.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ error: "Sign in required." }, 401);
    assertCsrf(req, session);
    const body = (await readJson(req)) as { name?: string };
    if (body.name && body.name.length > 80) throw new HttpError(400, "Token name is too long.");
    const created = await createApiToken(session.userId, body.name);
    return json({ id: created.id, token: created.token, preview: created.preview }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
