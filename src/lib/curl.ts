import { isHopByHop } from "./headers";
import { redactHeaderValue } from "./redact";
import type { HeaderPair } from "./types";

export type CurlInput = {
  method: string;
  url: string;
  headers: HeaderPair[];
  body?: string | null;
  bodyBase64?: string | null;
  binary?: boolean;
  redact?: boolean;
};

export function toCurl(input: CurlInput): string {
  const redact = input.redact !== false;
  const method = input.method.toUpperCase();
  const lines = [`curl -X ${method} ${shellSingle(input.url)}`];

  for (const header of input.headers) {
    if (isHopByHop(header.name)) continue;
    const value = redact ? redactHeaderValue(header.name, header.value) : header.value;
    lines.push(`  -H ${shellSingle(`${header.name}: ${value}`)}`);
  }

  if (input.binary) {
    lines.push(`  --data-binary @<(base64 -d <<< ${shellSingle(input.bodyBase64 ?? "")})`);
  } else if (input.body) {
    lines.push(`  --data-binary ${shellSingle(input.body)}`);
  }

  return lines.join(" \\\n");
}

export function shellSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
