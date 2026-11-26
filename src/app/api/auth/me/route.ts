import { githubOAuthEnabled, presentUser, sessionFromRequest } from "@/lib/auth";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return json({ user: null, githubOAuth: githubOAuthEnabled() }, 200);
    return json({ user: presentUser(session.user), csrfToken: session.csrfToken, githubOAuth: githubOAuthEnabled() });
  } catch (error) {
    return errorResponse(error);
  }
}
