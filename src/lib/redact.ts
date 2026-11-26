import type { HeaderPair } from "./types";

const SENSITIVE_NAME = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^x-api-key$/i,
  /^api-key$/i,
  /(^|[-_])api[-_]?key$/i,
  /(^|[-_])token($|[-_])/i,
  /(^|[-_])secret($|[-_])/i,
  /(^|[-_])signature($|[-_])/i,
  /(^|[-_])password($|[-_])/i,
  /^x-csrf($|[-_])/i,
  /^x-xsrf($|[-_])/i,
  /^x-amz-security-token$/i,
];

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_NAME.some((pattern) => pattern.test(name));
}

export function redactHeaderValue(name: string, value: string): string {
  if (!isSensitiveHeader(name)) return value;
  const trimmed = value.trim();
  if (trimmed.length <= 12) return "[redacted]";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function redactHeaders(headers: HeaderPair[], reveal: boolean): HeaderPair[] {
  if (reveal) return headers.map((header) => ({ ...header }));
  return headers.map((header) => ({
    name: header.name,
    value: redactHeaderValue(header.name, header.value),
  }));
}
