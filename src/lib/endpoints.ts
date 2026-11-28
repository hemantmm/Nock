import { Prisma, type Endpoint, type Event, type Replay } from "@prisma/client";
import { assertCsrf, sessionFromRequest, userFromApiToken } from "./auth";
import { defaultRetentionDays } from "./constants";
import { generateId, generateToken, hashToken, timingSafeEqualString } from "./crypto";
import { prisma } from "./db";
import { HttpError } from "./http";
import { decryptSecret, encryptSecret, secretPreview } from "./secrets";
import type { EndpointView, ProviderId, SigningEncoding } from "./types";
import { isProvider, isSigningEncoding } from "./providers";

export type EndpointUpdate = {
  name?: string;
  responseStatus?: number;
  responseBody?: string;
  responseContentType?: string;
  signingProvider?: ProviderId | null;
  signingSecret?: string | null;
  signingHeader?: string | null;
  signingEncoding?: SigningEncoding;
  timestampHeader?: string | null;
  toleranceSeconds?: number;
  retentionDays?: number;
  burstThreshold?: number;
};

export async function createEndpoint(name?: string, userId?: string | null): Promise<{ endpoint: Endpoint; token: string }> {
  const token = generateToken();
  const endpoint = await prisma.endpoint.create({
    data: {
      id: generateId("ep"),
      ownerTokenHash: hashToken(token),
      userId: userId ?? null,
      name: name?.trim() || "Untitled endpoint",
      retentionDays: defaultRetentionDays(),
    },
  });
  return { endpoint, token };
}

export async function endpointFromToken(id: string, token: string | null): Promise<Endpoint | null> {
  if (!token || !isEndpointId(id)) return null;
  const endpoint = await prisma.endpoint.findUnique({ where: { id } });
  if (!endpoint) return null;
  if (!timingSafeEqualString(hashToken(token), endpoint.ownerTokenHash)) return null;
  return endpoint;
}

export function readOwnerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    return token || null;
  }
  const header = req.headers.get("x-owner-token")?.trim();
  return header || null;
}

export async function requireEndpoint(req: Request, id: string): Promise<Endpoint | null> {
  if (!isEndpointId(id)) return null;
  const endpoint = await prisma.endpoint.findUnique({ where: { id } });
  if (!endpoint) return null;
  return authorizeEndpoint(req, endpoint);
}

export async function authorizeEndpoint(req: Request, endpoint: Endpoint): Promise<Endpoint | null> {
  const bearer = readOwnerToken(req);
  if (bearer?.startsWith("ht_")) {
    const user = await userFromApiToken(bearer);
    if (user && endpoint.userId === user.id) return endpoint;
  }
  if (bearer && timingSafeEqualString(hashToken(bearer), endpoint.ownerTokenHash)) return endpoint;
  const session = await sessionFromRequest(req);
  if (session && endpoint.userId === session.userId) {
    if (req.method !== "GET" && req.method !== "HEAD") assertCsrf(req, session);
    return endpoint;
  }
  return null;
}

export async function listOwnedEndpoints(userId: string): Promise<Endpoint[]> {
  return prisma.endpoint.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function claimEndpoint(userId: string, endpointId: string, ownerToken: string): Promise<Endpoint> {
  if (!isEndpointId(endpointId)) throw new HttpError(404, "Endpoint not found.");
  const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
  if (!endpoint || !timingSafeEqualString(hashToken(ownerToken), endpoint.ownerTokenHash)) {
    throw new HttpError(404, "Endpoint not found.");
  }
  if (endpoint.userId && endpoint.userId !== userId) throw new HttpError(404, "Endpoint not found.");
  if (endpoint.userId === userId) return endpoint;
  return prisma.endpoint.update({ where: { id: endpoint.id }, data: { userId } });
}

export function isEndpointId(id: string): boolean {
  return /^ep_[A-Za-z0-9_-]{16,64}$/.test(id);
}

export async function updateEndpoint(endpoint: Endpoint, update: EndpointUpdate): Promise<Endpoint> {
  const data: Prisma.EndpointUpdateInput = {};
  if (update.name !== undefined) data.name = update.name.trim() || "Untitled endpoint";
  if (update.responseStatus !== undefined) data.responseStatus = update.responseStatus;
  if (update.responseBody !== undefined) data.responseBody = update.responseBody;
  if (update.responseContentType !== undefined) data.responseContentType = update.responseContentType;
  if (update.toleranceSeconds !== undefined) data.toleranceSeconds = update.toleranceSeconds;
  if (update.retentionDays !== undefined) data.retentionDays = update.retentionDays;
  if (update.burstThreshold !== undefined) data.burstThreshold = update.burstThreshold;
  if (update.signingHeader !== undefined) data.signingHeader = update.signingHeader?.trim() || null;
  if (update.signingEncoding !== undefined) data.signingEncoding = update.signingEncoding;
  if (update.timestampHeader !== undefined) data.timestampHeader = update.timestampHeader?.trim() || null;

  if (update.signingProvider !== undefined) {
    data.signingProvider = update.signingProvider;
    if (update.signingProvider === null) data.signingSecretEnc = null;
  }
  if (update.signingSecret !== undefined) {
    data.signingSecretEnc = update.signingSecret ? encryptSecret(update.signingSecret) : null;
  }

  return prisma.endpoint.update({ where: { id: endpoint.id }, data });
}

export function signingSettingsChanged(update: EndpointUpdate): boolean {
  return (
    update.signingProvider !== undefined ||
    update.signingSecret !== undefined ||
    update.signingHeader !== undefined ||
    update.signingEncoding !== undefined ||
    update.timestampHeader !== undefined ||
    update.toleranceSeconds !== undefined
  );
}

export function presentEndpoint(endpoint: Endpoint, options?: { includeSecret?: boolean }): EndpointView & {
  signingSecret?: string | null;
} {
  let preview: string | null = null;
  let signingSecret: string | null = null;
  if (endpoint.signingSecretEnc) {
    try {
      const plain = decryptSecret(endpoint.signingSecretEnc);
      preview = secretPreview(plain);
      if (options?.includeSecret) signingSecret = plain;
    } catch {
      preview = "unavailable";
    }
  }
  const provider = isProvider(endpoint.signingProvider) ? endpoint.signingProvider : null;
  return {
    id: endpoint.id,
    name: endpoint.name,
    hookPath: `/h/${endpoint.id}`,
    responseStatus: endpoint.responseStatus,
    responseBody: endpoint.responseBody,
    responseContentType: endpoint.responseContentType,
    signingProvider: provider,
    hasSigningSecret: Boolean(endpoint.signingSecretEnc) && preview !== "unavailable",
    signingSecretPreview: preview,
    signingHeader: endpoint.signingHeader,
    signingEncoding: isSigningEncoding(endpoint.signingEncoding) ? endpoint.signingEncoding : "hex",
    timestampHeader: endpoint.timestampHeader,
    toleranceSeconds: endpoint.toleranceSeconds,
    retentionDays: endpoint.retentionDays,
    burstThreshold: endpoint.burstThreshold,
    createdAt: endpoint.createdAt.toISOString(),
    ...(options?.includeSecret ? { signingSecret } : {}),
  };
}

export function signingSecretOf(endpoint: Endpoint): { secret: string | null; error?: string } {
  if (!endpoint.signingSecretEnc) return { secret: null };
  try {
    return { secret: decryptSecret(endpoint.signingSecretEnc) };
  } catch {
    return { secret: null, error: "decrypt" };
  }
}

export type { Event, Replay };
