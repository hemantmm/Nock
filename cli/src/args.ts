const ENDPOINT_ID = /^ep_[A-Za-z0-9_-]{16,64}$/;

export type GlobalFlags = {
  server?: string;
  token?: string;
  json: boolean;
};

export type ListenCommand = GlobalFlags & {
  command: "listen";
  endpointId: string;
  forward?: string;
  port?: number;
  path?: string;
  from: string | null;
};

export type ReplayCommand = GlobalFlags & {
  command: "replay";
  eventId: string;
  forward?: string;
  port?: number;
  path?: string;
};

export type LoginCommand = GlobalFlags & {
  command: "login";
  email?: string;
  password?: string;
  name?: string;
};

export type ParsedArgs = ListenCommand | ReplayCommand | LoginCommand | { command: "help" };

export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return { command: "help" };
  const command = args.shift();
  if (command !== "listen" && command !== "replay" && command !== "login") {
    throw new Error(`Unknown command "${command ?? ""}". Use listen, replay, or login.`);
  }
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  while (args.length > 0) {
    const token = args.shift()!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === "json") {
      flags.set(key, true);
      continue;
    }
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    flags.set(key, value);
  }
  const json = flags.get("json") === true;
  const server = typeof flags.get("server") === "string" ? String(flags.get("server")) : undefined;
  const token = typeof flags.get("token") === "string" ? String(flags.get("token")) : undefined;
  const forward = typeof flags.get("forward") === "string" ? String(flags.get("forward")) : undefined;
  const port = flags.has("port") ? Number(flags.get("port")) : undefined;
  const path = typeof flags.get("path") === "string" ? String(flags.get("path")) : undefined;
  const email = typeof flags.get("email") === "string" ? String(flags.get("email")) : undefined;
  const password = typeof flags.get("password") === "string" ? String(flags.get("password")) : undefined;
  const name = typeof flags.get("name") === "string" ? String(flags.get("name")) : undefined;
  if (port !== undefined && !Number.isInteger(port)) throw new Error("--port must be an integer.");

  if (command === "login") {
    if (positionals.length !== 0) throw new Error("hooktrace login does not take a positional argument.");
    return { command, server, token, email, password, name, json };
  }
  if (positionals.length !== 1) {
    throw new Error(command === "listen" ? "Usage: hooktrace listen <endpoint-id-or-url>" : "Usage: hooktrace replay <event-id>");
  }

  if (command === "listen") {
    const parsed = parseEndpointRef(positionals[0]!);
    return {
      command,
      endpointId: parsed.endpointId,
      server: server ?? parsed.server,
      token: token ?? parsed.token,
      json,
      forward,
      port,
      path,
      from: typeof flags.get("from") === "string" ? String(flags.get("from")) : null,
    };
  }
  const eventId = positionals[0]!;
  if (!eventId.startsWith("evt_")) throw new Error("The event id should look like evt_…");
  return { command, eventId, server, token, json, forward, port, path };
}

export function parseEndpointRef(input: string): { endpointId: string; server?: string; token?: string } {
  const hashAt = input.indexOf("#");
  const hash = hashAt >= 0 ? input.slice(hashAt + 1) : "";
  const withoutHash = hashAt >= 0 ? input.slice(0, hashAt) : input;
  const token = hash ? (new URLSearchParams(hash).get("t") ?? undefined) : undefined;
  if (ENDPOINT_ID.test(withoutHash)) return { endpointId: withoutHash, token };
  let url: URL;
  try {
    url = new URL(withoutHash);
  } catch {
    throw new Error("Pass an endpoint id like ep_… or a HookTrace /h/ or /inbox/ URL.");
  }
  const id = url.pathname.split("/").find((part) => ENDPOINT_ID.test(part));
  if (!id) throw new Error("That URL does not contain an endpoint id.");
  return { endpointId: id, server: url.origin, token };
}

export const HELP = `hooktrace listen <endpoint-id-or-url> --forward http://localhost:3000/webhooks
hooktrace listen <endpoint-id-or-url> --port 3000 --path /webhooks
hooktrace replay <event-id> --forward http://localhost:3000/webhooks
hooktrace login --email you@example.com --password <password>

Options
  --server <url>     HookTrace base URL. Defaults to HOOKTRACE_URL or http://localhost:4317.
                     A full endpoint URL sets this when --server is omitted.
  --token <token>    Owner token or API token (ht_…). Also read from HOOKTRACE_TOKEN,
                     an inbox URL hash #t=, or ~/.config/hooktrace/credentials.json.
  --email <email>    Account email for hooktrace login.
  --password <pw>    Account password for hooktrace login. HOOKTRACE_PASSWORD also works.
  --forward <url>    Local base URL. The path after /h/<id> is appended.
  --port <n>         Shorthand for http://localhost:<n>
  --path <path>      Path used with --port. Defaults to /.
  --from <event-id>  Resume listen from this event instead of "now".
  --json             Print one JSON object per line.
`;
