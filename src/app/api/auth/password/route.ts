import { assertCsrf, assertPassword, sessionFromRequest } from "@/lib/auth";
import { errorResponse, json, readJson, HttpError } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ error: "Sign in required." }, 401);
    assertCsrf(req, session);
    const body = (await readJson(req)) as { currentPassword?: string; newPassword?: string };
    if (!body.newPassword) throw new HttpError(400, "Enter a new password.");
    assertPassword(body.newPassword);
    if (session.user.passwordHash) {
      if (!body.currentPassword) throw new HttpError(400, "Enter your current password.");
      const matches = await verifyPassword(body.currentPassword, session.user.passwordHash);
      if (!matches) throw new HttpError(401, "Current password is wrong.");
    }
    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    return json({ updated: true });
  } catch (error) {
    return errorResponse(error);
  }
}
