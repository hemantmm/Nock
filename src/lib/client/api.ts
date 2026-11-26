export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const csrf = readBrowserCsrf();
  if (csrf && !headers.has("x-csrf-token")) headers.set("x-csrf-token", csrf);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) throw new ApiError(data.error || "Request failed.", response.status);
  return data;
}

export function readBrowserCsrf(): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split("; ");
  const found = parts.find((part) => part.startsWith("hooktrace_csrf="));
  if (!found) return null;
  return decodeURIComponent(found.slice("hooktrace_csrf=".length));
}
