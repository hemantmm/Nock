export type SseMessage = { id?: string; event?: string; data: string };

export function createSseParser(onMessage: (message: SseMessage) => void): { push(chunk: string): void } {
  let buffer = "";
  let id = "";
  let event = "";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length === 0 && !id && !event) return;
    if (data.length > 0) onMessage({ id: id || undefined, event: event || undefined, data: data.join("\n") });
    id = "";
    event = "";
    data = [];
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line === "") {
          dispatch();
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "id") id = value;
        else if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
    },
  };
}

export function nextBackoff(currentMs: number): number {
  if (currentMs < 500) return 500;
  return Math.min(currentMs * 2, 15_000);
}
