import { createSession, githubOAuthEnabled, upsertGithubUser } from "@/lib/auth";
import { clearCookie, readOauthStateCookie } from "@/lib/cookies";
import { timingSafeEqualString } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GithubUser = { id: number; name: string | null; email: string | null };
type GithubEmail = { email: string; primary: boolean; verified: boolean };

export async function GET(req: Request): Promise<Response> {
  if (!githubOAuthEnabled()) {
    return Response.redirect(new URL("/signin?error=github-disabled", req.url));
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expected = readOauthStateCookie(req) ?? "";
  if (!code || !state || !expected || state.length !== expected.length || !timingSafeEqualString(state, expected)) {
    return Response.redirect(new URL("/signin?error=github-state", req.url));
  }
  try {
    const accessToken = await exchangeCode(code, req);
    const profile = await githubProfile(accessToken);
    const user = await upsertGithubUser(profile);
    const session = await createSession(user.id);
    const headers = new Headers({ location: new URL("/dashboard", req.url).toString(), "cache-control": "no-store" });
    for (const cookie of session.cookies) headers.append("set-cookie", cookie);
    headers.append("set-cookie", clearCookie("hooktrace_oauth_state"));
    return new Response(null, { status: 302, headers });
  } catch {
    return Response.redirect(new URL("/signin?error=github", req.url));
  }
}

async function exchangeCode(code: string, req: Request): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${new URL(req.url).origin}/api/auth/github/callback`,
    }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("GitHub did not return an access token.");
  return body.access_token;
}

async function githubProfile(accessToken: string): Promise<{ githubId: string; email: string; name: string | null }> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "hooktrace" };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  const user = (await userResponse.json()) as GithubUser;
  let email = user.email;
  if (!email) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
    const emails = (await emailsResponse.json()) as GithubEmail[];
    email = emails.find((item) => item.primary && item.verified)?.email ?? emails.find((item) => item.verified)?.email ?? null;
  }
  if (!email) throw new Error("GitHub account has no verified email.");
  return { githubId: String(user.id), email, name: user.name };
}
