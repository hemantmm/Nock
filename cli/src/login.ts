import { saveCredentials, type StoredCredentials } from "./config.js";

export async function loginWithPassword(input: {
  server: string;
  email: string;
  password: string;
  name?: string;
}): Promise<StoredCredentials> {
  const response = await fetch(`${input.server.replace(/\/+$/, "")}/api/auth/cli`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password, name: input.name || "CLI" }),
  });
  const body = (await response.json()) as { token?: string; email?: string; error?: string };
  if (!response.ok || !body.token) throw new Error(body.error || "Login failed.");
  return { server: input.server.replace(/\/+$/, ""), token: body.token, email: body.email };
}

export function persistLogin(credentials: StoredCredentials, dir?: string): void {
  saveCredentials(credentials, dir);
}
