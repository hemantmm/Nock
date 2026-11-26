import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type StoredCredentials = {
  server: string;
  token: string;
  email?: string;
};

export function configDir(): string {
  return process.env.HOOKTRACE_CONFIG_DIR || path.join(os.homedir(), ".config", "hooktrace");
}

export function credentialsPath(dir = configDir()): string {
  return path.join(dir, "credentials.json");
}

export function saveCredentials(credentials: StoredCredentials, dir = configDir()): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = credentialsPath(dir);
  fs.writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function loadCredentials(server?: string, dir = configDir()): StoredCredentials | null {
  const file = credentialsPath(dir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredCredentials;
    if (!parsed.token) return null;
    if (server && parsed.server && normalize(parsed.server) !== normalize(server)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}
