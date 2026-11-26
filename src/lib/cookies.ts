const SESSION_COOKIE = "hooktrace_session";
const CSRF_COOKIE = "hooktrace_csrf";
const OAUTH_COOKIE = "hooktrace_oauth_state";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function secureSuffix(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureSuffix()}`;
}

export function csrfCookie(token: string, maxAge = SESSION_MAX_AGE): string {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureSuffix()}`;
}

export function oauthStateCookie(state: string): string {
  return `${OAUTH_COOKIE}=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secureSuffix()}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax${secureSuffix()}`;
}

export function clearSessionCookies(): string[] {
  return [clearCookie(SESSION_COOKIE), clearCookie(CSRF_COOKIE)];
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

export function readSessionCookie(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE);
}

export function readCsrfCookie(req: Request): string | null {
  return readCookie(req, CSRF_COOKIE);
}

export function readOauthStateCookie(req: Request): string | null {
  return readCookie(req, OAUTH_COOKIE);
}

export function jsonWithCookies(data: unknown, status: number, cookies: string[]): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
