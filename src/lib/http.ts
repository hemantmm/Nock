export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (extra) {
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error(error instanceof Error ? error.message : "request failed");
  return json({ error: "Something went wrong." }, 500);
}

export async function readJson(req: Request, limit = 1_500_000): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, "Request body is too large.");
  }
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "Request body is too large.");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

export async function readLimitedBody(
  req: Request,
  limit: number,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  if (!req.body) return { bytes: Buffer.alloc(0), truncated: false };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (received >= limit) {
        truncated = true;
        break;
      }
      if (received + value.byteLength > limit) {
        chunks.push(value.subarray(0, limit - received));
        received = limit;
        truncated = true;
        break;
      }
      chunks.push(value);
      received += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The body is already finished or cancelled.
    }
  }
  return { bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), truncated };
}
