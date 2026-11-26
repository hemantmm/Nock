import pc from "picocolors";

export type PrintedEvent = {
  time: string;
  method: string;
  path: string;
  provider: string | null;
  verification: "valid" | "invalid" | "unchecked";
  reason: string | null;
  summary: string | null;
  localStatus: number | null;
  latencyMs: number;
  target: string;
  error: string | null;
};

export function formatEvent(event: PrintedEvent, json: boolean): string {
  if (json) return JSON.stringify(event);
  const time = pc.dim(event.time.slice(11, 19));
  const method = pc.bold(event.method.padEnd(6));
  const provider = event.provider ? pc.cyan(providerName(event.provider)) : pc.dim("unchecked");
  let verdict = pc.dim("no signature");
  if (event.verification === "valid") verdict = pc.green("valid");
  if (event.verification === "invalid") verdict = pc.red(`invalid  ${event.summary ?? event.reason ?? ""}`.trim());
  const status =
    event.localStatus === null
      ? pc.red(event.error ?? "failed")
      : event.localStatus >= 200 && event.localStatus < 300
        ? pc.green(String(event.localStatus))
        : pc.yellow(String(event.localStatus));
  return `${time}  ${method} ${event.path}  ${provider}  ${verdict}  → ${status}  ${pc.dim(`${event.latencyMs}ms`)}`;
}

export function providerName(provider: string): string {
  if (provider === "github") return "GitHub";
  if (provider === "razorpay") return "Razorpay";
  if (provider === "hmac_sha256") return "HMAC";
  if (provider === "stripe") return "Stripe";
  return provider;
}
