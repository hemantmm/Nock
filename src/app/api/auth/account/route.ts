import { assertCsrf, normalizeEmail, sessionFromRequest } from "@/lib/auth";
import { clearSessionCookies, jsonWithCookies } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse, json, readJson } from "@/lib/http";
import { verifyPassword } from "@/lib/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ error: "Sign in required." }, 401);
    assertCsrf(req, session);
    const body = (await readJson(req)) as { password?: string; confirmEmail?: string };
    if (session.user.passwordHash) {
      if (!body.password) throw new HttpError(400, "Enter your password to delete the account.");
      const matches = await verifyPassword(body.password, session.user.passwordHash);
      if (!matches) throw new HttpError(401, "Password is wrong.");
    } else if (normalizeEmail(body.confirmEmail ?? "") !== session.user.email) {
      throw new HttpError(400, "Type your email to confirm account deletion.");
    }
    await prisma.user.delete({ where: { id: session.userId } });
    return jsonWithCookies({ deleted: true }, 200, clearSessionCookies());
  } catch (error) {
    return errorResponse(error);
  }
}
