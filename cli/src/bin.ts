#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { HELP, parseArgs } from "./args.js";
import { configDir, loadCredentials } from "./config.js";
import { loginWithPassword, persistLogin } from "./login.js";
import { listen, replayEvent } from "./session.js";
import { resolveForwardBase } from "./target.js";

const DEFAULT_SERVER = "http://localhost:4317";

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not read the command.");
    console.error(HELP);
    return 1;
  }
  if (parsed.command === "help") {
    console.log(HELP);
    return 0;
  }
  const server = (parsed.server || process.env.HOOKTRACE_URL || DEFAULT_SERVER).replace(/\/+$/, "");
  if (parsed.command === "login") {
    try {
      const dir = configDir();
      if (parsed.token) {
        persistLogin({ server, token: parsed.token, email: parsed.email }, dir);
      } else {
        const email = parsed.email || process.env.HOOKTRACE_EMAIL || "";
        const password = parsed.password || process.env.HOOKTRACE_PASSWORD || "";
        if (!email || !password) {
          console.error("Pass --email and --password, or --token from account settings.");
          return 1;
        }
        const credentials = await loginWithPassword({ server, email, password, name: parsed.name });
        persistLogin(credentials, dir);
      }
      console.log(`Saved API credentials for ${server}`);
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Login failed.");
      return 1;
    }
  }
  const token = parsed.token || process.env.HOOKTRACE_TOKEN || loadCredentials(server)?.token || "";
  if (!token) {
    console.error("Missing owner token. Pass --token, set HOOKTRACE_TOKEN, or use an inbox URL ending in #t=<token>.");
    console.error("Copy the token from the inbox settings. It is the only key that can read the endpoint.");
    return 1;
  }
  let forwardBase: string;
  try {
    forwardBase = resolveForwardBase({ forward: parsed.forward, port: parsed.port, path: parsed.path });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The forward target is invalid.");
    return 1;
  }
  const options = {
    server,
    token,
    endpointId: parsed.command === "listen" ? parsed.endpointId : "",
    forwardBase,
    json: parsed.json,
    from: parsed.command === "listen" ? parsed.from : null,
  };
  if (parsed.command === "replay") {
    try {
      await replayEvent(parsed.eventId, options);
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Replay failed.");
      return 1;
    }
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await listen(options, controller.signal);
  return 0;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : "hooktrace failed");
      process.exit(1);
    },
  );
}
