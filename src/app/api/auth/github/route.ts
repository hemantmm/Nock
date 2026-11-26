import { githubOAuthEnabled } from "@/lib/auth";
import { oauthStateCookie } from "@/lib/cookies";
import { generateToken } from "@/lib/crypto";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!githubOAuthEnabled()) return json({ error: "GitHub sign-in is not configured." }, 404);
  const state = generateToken(16);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", callbackUrl(req));
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      "set-cookie": oauthStateCookie(state),
      "cache-control": "no-store",
    },
  });
}

function callbackUrl(req: Request): string {
  const origin = new URL(req.url).origin;
  return `${origin}/api/auth/github/callback`;
}
