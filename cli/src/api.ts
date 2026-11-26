import type { CapturedEvent, HeaderPair, VerificationSnapshot } from "./target.js";

type DetailResponse = {
  id: string;
  method: string;
  path: string;
  query: HeaderPair[];
  headers: HeaderPair[];
  bodyBase64: string;
  verification: {
    status: "valid" | "invalid";
    provider: string;
    reason: string;
    summary: string;
  } | null;
};

export async function fetchEvent(
  server: string,
  token: string,
  endpointId: string,
  eventId: string,
): Promise<CapturedEvent> {
  const response = await fetch(`${trimSlash(server)}/api/endpoints/${endpointId}/events/${eventId}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const detail = (await response.json()) as DetailResponse;
  return toCaptured(endpointId, detail);
}

export async function fetchEventById(server: string, token: string, eventId: string): Promise<CapturedEvent> {
  const response = await fetch(`${trimSlash(server)}/api/events/${eventId}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const body = (await response.json()) as { endpointId: string; event: DetailResponse };
  return toCaptured(body.endpointId, body.event);
}

export async function reportForward(
  server: string,
  token: string,
  endpointId: string,
  eventId: string,
  report: {
    targetUrl: string;
    method: string;
    responseStatus: number | null;
    latencyMs: number;
    error: string | null;
    responseBody: string | null;
    responseTruncated: boolean;
    responseHeaders: HeaderPair[];
  },
): Promise<void> {
  const response = await fetch(`${trimSlash(server)}/api/endpoints/${endpointId}/events/${eventId}/forward`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(report),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

function toCaptured(endpointId: string, detail: DetailResponse): CapturedEvent {
  const verification: VerificationSnapshot = detail.verification
    ? {
        status: detail.verification.status,
        provider: detail.verification.provider,
        reason: detail.verification.reason,
        summary: detail.verification.summary,
      }
    : null;
  return {
    id: detail.id,
    endpointId,
    method: detail.method,
    path: detail.path,
    query: detail.query ?? [],
    headers: detail.headers ?? [],
    body: Buffer.from(detail.bodyBase64, "base64"),
    verification,
  };
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // The body was not JSON.
  }
  return `HookTrace responded ${response.status}.`;
}

function trimSlash(server: string): string {
  return server.replace(/\/+$/, "");
}
