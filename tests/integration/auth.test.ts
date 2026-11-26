import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as claim } from "../../src/app/api/auth/claim/route";
import { POST as cliLogin } from "../../src/app/api/auth/cli/route";
import { GET as githubStart } from "../../src/app/api/auth/github/route";
import { GET as me } from "../../src/app/api/auth/me/route";
import { POST as signin } from "../../src/app/api/auth/signin/route";
import { POST as signup } from "../../src/app/api/auth/signup/route";
import { DELETE as revokeToken } from "../../src/app/api/auth/tokens/[id]/route";
import { GET as listTokens, POST as createToken } from "../../src/app/api/auth/tokens/route";
import { GET as listEndpoints, POST as createEndpoint } from "../../src/app/api/endpoints/route";
import { DELETE as deleteEndpoint, GET as readEndpoint } from "../../src/app/api/endpoints/[id]/route";
import { GET as stream } from "../../src/app/api/endpoints/[id]/stream/route";
import { prisma } from "../../src/lib/db";
import { resetRateLimits } from "../../src/lib/rate-limit";
import { loadCredentials, saveCredentials } from "../../cli/src/config";
import { parseArgs } from "../../cli/src/args";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const password = "correct-horse";

function cookieHeader(response: Response): { cookie: string; csrf: string } {
  const cookies = response.headers.getSetCookie();
  const csrf = cookies.find((item) => item.startsWith("hooktrace_csrf="))?.split(";")[0]?.split("=").slice(1).join("=") ?? "";
  return { cookie: cookies.map((item) => item.split(";")[0]).join("; "), csrf: decodeURIComponent(csrf) };
}

async function signUp(email: string): Promise<{ cookie: string; csrf: string }> {
  const response = await signup(
    new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": email },
      body: JSON.stringify({ email, password, name: email.split("@")[0] }),
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { user: { email: string }; csrfToken: string };
  expect(body.user.email).toBe(email);
    const parsed = cookieHeader(response);
    expect(parsed.csrf).toBe(body.csrfToken);
    const rawCookies = response.headers.getSetCookie();
    expect(rawCookies.some((item) => item.startsWith("hooktrace_session=") && item.includes("HttpOnly"))).toBe(true);
    expect(rawCookies.some((item) => item.startsWith("hooktrace_csrf=") && !item.includes("HttpOnly"))).toBe(true);
    return parsed;
}

async function openEndpoint(request: Request) {
  const id = new URL(request.url).pathname.split("/")[3] ?? "";
  return readEndpoint(request, { params: Promise.resolve({ id }) });
}

function authed(url: string, auth: { cookie: string; csrf: string }, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("cookie", auth.cookie);
  headers.set("x-csrf-token", auth.csrf);
  return new Request(url, { ...init, headers });
}

describe("accounts", () => {
  beforeEach(async () => resetRateLimits());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: "@hooktrace.test" } } });
    await prisma.endpoint.deleteMany({ where: { name: "test-claim-anon" } });
    await prisma.$disconnect();
  });

  it("signs up, rejects a bad password, and keeps sessions behind httpOnly cookies", async () => {
    const auth = await signUp("ada@hooktrace.test");
    const wrong = await signin(
      new Request("http://localhost/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@hooktrace.test", password: "not-the-password" }),
      }),
    );
    expect(wrong.status).toBe(401);
    const profile = await me(new Request("http://localhost/api/auth/me", { headers: { cookie: auth.cookie } }));
    expect(profile.status).toBe(200);
    const body = (await profile.json()) as { user: { email: string } };
    expect(body.user.email).toBe("ada@hooktrace.test");
    const sessionCookie = auth.cookie.split("; ").find((item) => item.startsWith("hooktrace_session=")) ?? "";
    expect(sessionCookie.includes("HttpOnly")).toBe(false);
  });

  it("hides one user's endpoints from another user and from a revoked API token", async () => {
    const ada = await signUp("ada-own@hooktrace.test");
    const grace = await signUp("grace-own@hooktrace.test");
    const created = await createEndpoint(
      authed("http://localhost/api/endpoints", ada, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada inbox" }),
      }),
    );
    expect(created.status).toBe(201);
    const endpoint = (await created.json()) as { id: string; token: string };

    const stranger = await openEndpoint(
      authed(`http://localhost/api/endpoints/${endpoint.id}`, grace),
    );
    expect(stranger.status).toBe(404);

    const noCsrf = await openEndpoint(
      new Request(`http://localhost/api/endpoints/${endpoint.id}`, {
        method: "DELETE",
        headers: { cookie: grace.cookie },
      }),
    );
    expect([403, 404]).toContain(noCsrf.status);

    const owner = await openEndpoint(authed(`http://localhost/api/endpoints/${endpoint.id}`, ada));
    expect(owner.status).toBe(200);
    const missingCsrf = await deleteEndpoint(
      new Request(`http://localhost/api/endpoints/${endpoint.id}`, {
        method: "DELETE",
        headers: { cookie: ada.cookie },
      }),
      { params: Promise.resolve({ id: endpoint.id }) },
    );
    expect(missingCsrf.status).toBe(403);

    const minted = await createToken(
      authed("http://localhost/api/auth/tokens", ada, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "laptop" }),
      }),
    );
    expect(minted.status).toBe(201);
    const apiToken = (await minted.json()) as { id: string; token: string };
    const viaToken = await openEndpoint(
      new Request(`http://localhost/api/endpoints/${endpoint.id}`, {
        headers: { authorization: `Bearer ${apiToken.token}` },
      }),
    );
    expect(viaToken.status).toBe(200);

    const listed = await listTokens(new Request("http://localhost/api/auth/tokens", { headers: { cookie: ada.cookie } }));
    const tokens = (await listed.json()) as { tokens: { id: string; lastUsedAt: string | null }[] };
    expect(tokens.tokens.find((item) => item.id === apiToken.id)?.lastUsedAt).toBeTruthy();

    const otherToken = await openEndpoint(
      new Request(`http://localhost/api/endpoints/${endpoint.id}`, {
        headers: { authorization: `Bearer ${apiToken.token}nope` },
      }),
    );
    expect(otherToken.status).toBe(404);

    const graceList = await listEndpoints(authed("http://localhost/api/endpoints", grace));
    const graceBody = (await graceList.json()) as { endpoints: { id: string }[] };
    expect(graceBody.endpoints.map((item) => item.id)).not.toContain(endpoint.id);

    const streamDenied = await stream(
      authed(`http://localhost/api/endpoints/${endpoint.id}/stream`, grace),
      { params: Promise.resolve({ id: endpoint.id }) },
    );
    expect(streamDenied.status).toBe(404);

    const revoked = await revokeToken(
      authed(`http://localhost/api/auth/tokens/${apiToken.id}`, ada, { method: "DELETE" }),
      { params: Promise.resolve({ id: apiToken.id }) },
    );
    expect(revoked.status).toBe(200);
    const afterRevoke = await openEndpoint(
      new Request(`http://localhost/api/endpoints/${endpoint.id}`, {
        headers: { authorization: `Bearer ${apiToken.token}` },
      }),
    );
    expect(afterRevoke.status).toBe(404);

    const ownerTokenStillWorks = await openEndpoint(
      new Request(`http://localhost/api/endpoints/${endpoint.id}`, {
        headers: { authorization: `Bearer ${endpoint.token}` },
      }),
    );
    expect(ownerTokenStillWorks.status).toBe(200);
  });

  it("claims an anonymous endpoint and refuses a second user's claim", async () => {
    const anonymous = await createEndpoint(
      new Request("http://localhost/api/endpoints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "test-claim-anon" }),
      }),
    );
    const created = (await anonymous.json()) as { id: string; token: string };
    const ada = await signUp("ada-claim@hooktrace.test");
    const claimed = await claim(
      authed("http://localhost/api/auth/claim", ada, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpointId: created.id, ownerToken: created.token }),
      }),
    );
    expect(claimed.status).toBe(200);
    const grace = await signUp("grace-claim@hooktrace.test");
    const stolen = await claim(
      authed("http://localhost/api/auth/claim", grace, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpointId: created.id, ownerToken: created.token }),
      }),
    );
    expect(stolen.status).toBe(404);
    const graceRead = await openEndpoint(authed(`http://localhost/api/endpoints/${created.id}`, grace));
    expect(graceRead.status).toBe(404);
    const adaRead = await openEndpoint(authed(`http://localhost/api/endpoints/${created.id}`, ada));
    expect(adaRead.status).toBe(200);
  });

  it("issues a CLI token from email and password and stores it without printing it back from disk lookup", async () => {
    await signUp("cli@hooktrace.test");
    const response = await cliLogin(
      new Request("http://localhost/api/auth/cli", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "cli-login" },
        body: JSON.stringify({ email: "cli@hooktrace.test", password, name: "laptop" }),
      }),
    );
    expect(response.status).toBe(201);
    const issued = (await response.json()) as { token: string; email: string };
    expect(issued.token.startsWith("ht_")).toBe(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooktrace-cli-"));
    saveCredentials({ server: "http://127.0.0.1:4317", token: issued.token, email: issued.email }, dir);
    const loaded = loadCredentials("http://127.0.0.1:4317", dir);
    expect(loaded?.token).toBe(issued.token);
    expect(loadCredentials("http://other.example", dir)).toBeNull();
    const mode = fs.statSync(path.join(dir, "credentials.json")).mode & 0o777;
    expect(mode).toBe(0o600);
    const parsed = parseArgs(["login", "--email", "cli@hooktrace.test", "--server", "http://127.0.0.1:4317"]);
    expect(parsed).toMatchObject({ command: "login", email: "cli@hooktrace.test" });

    const created = await createEndpoint(
      new Request("http://localhost/api/endpoints", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${issued.token}`,
        },
        body: JSON.stringify({ name: "from-cli-token" }),
      }),
    );
    expect(created.status).toBe(201);
    const owned = (await created.json()) as { id: string };
    const readable = await openEndpoint(
      new Request(`http://localhost/api/endpoints/${owned.id}`, {
        headers: { authorization: `Bearer ${issued.token}` },
      }),
    );
    expect(readable.status).toBe(200);
  });

  it("reports GitHub sign-in as unavailable until the client id and secret are set", async () => {
    const previousId = process.env.GITHUB_CLIENT_ID;
    const previousSecret = process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    try {
      const response = await githubStart(new Request("http://localhost/api/auth/github"));
      expect(response.status).toBe(404);
    } finally {
      if (previousId) process.env.GITHUB_CLIENT_ID = previousId;
      if (previousSecret) process.env.GITHUB_CLIENT_SECRET = previousSecret;
    }
  });
});
