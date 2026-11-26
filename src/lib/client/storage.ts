export type SavedEndpoint = {
  id: string;
  token: string;
  name: string;
  createdAt: string;
};

const KEY = "hooktrace.endpoints";

export function loadEndpoints(): SavedEndpoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedEndpoint =>
        !!item &&
        typeof item === "object" &&
        typeof (item as SavedEndpoint).id === "string" &&
        typeof (item as SavedEndpoint).token === "string",
    );
  } catch {
    return [];
  }
}

export function saveEndpoint(endpoint: SavedEndpoint): void {
  const existing = loadEndpoints().filter((item) => item.id !== endpoint.id);
  window.localStorage.setItem(KEY, JSON.stringify([endpoint, ...existing].slice(0, 30)));
}

export function forgetEndpoint(id: string): void {
  const existing = loadEndpoints().filter((item) => item.id !== id);
  window.localStorage.setItem(KEY, JSON.stringify(existing));
}

export function tokenFor(id: string): string | null {
  return loadEndpoints().find((item) => item.id === id)?.token ?? null;
}
