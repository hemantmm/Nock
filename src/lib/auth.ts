import type { Session, User } from "@prisma/client";
import { generateId, generateToken, hashToken, timingSafeEqualString } from "./crypto";
import {
  csrfCookie,
  readCsrfCookie,
  readSessionCookie,
  sessionCookie,
  SESSION_MAX_AGE,
} from "./cookies";
import { prisma } from "./db";
import { HttpError } from "./http";
import { hashPassword, verifyPassword } from "./password";

const API_PREFIX = "ht_";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertPassword(password: string): void {
  if (password.length < 10 || password.length > 200) {
    throw new HttpError(400, "Use a password between 10 and 200 characters.");
  }
}

export function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 200) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return normalized;
}

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  hasPassword: boolean;
  githubLinked: boolean;
};

export function presentUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    hasPassword: Boolean(user.passwordHash),
    githubLinked: Boolean(user.githubId),
  };
}

export async function createUser(input: { email: string; password: string; name?: string | null }): Promise<User> {
  const email = assertEmail(input.email);
  assertPassword(input.password);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "An account with that email already exists.");
  return prisma.user.create({
    data: {
      id: generateId("usr", 12),
      email,
      name: input.name?.trim() || null,
      passwordHash: await hashPassword(input.password),
    },
  });
}

export async function authenticatePassword(email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  const hash = user?.passwordHash ?? "$2a$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const matches = await verifyPassword(password, hash);
  if (!user?.passwordHash || !matches) {
    throw new HttpError(401, "Email or password is wrong.");
  }
  return user;
}

export async function createSession(userId: string): Promise<{ csrfToken: string; cookies: string[] }> {
  const token = generateToken();
  const csrfToken = generateToken(24);
  await prisma.session.create({
    data: {
      id: generateId("ses", 12),
      userId,
      tokenHash: hashToken(token),
      csrfToken,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000),
    },
  });
  return { csrfToken, cookies: [sessionCookie(token), csrfCookie(csrfToken)] };
}

export async function sessionFromRequest(req: Request): Promise<(Session & { user: User }) | null> {
  const raw = readSessionCookie(req);
  if (!raw) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

export function assertCsrf(req: Request, session: Session): void {
  const header = req.headers.get("x-csrf-token") ?? "";
  const cookie = readCsrfCookie(req) ?? "";
  const headerOk = header.length === session.csrfToken.length && timingSafeEqualString(header, session.csrfToken);
  const cookieOk = cookie.length === session.csrfToken.length && timingSafeEqualString(cookie, session.csrfToken);
  if (!headerOk || !cookieOk) throw new HttpError(403, "CSRF check failed.");
}

export async function createApiToken(userId: string, name?: string): Promise<{ id: string; token: string; preview: string }> {
  const token = `${API_PREFIX}${generateToken(32)}`;
  const preview = `${token.slice(0, 7)}…${token.slice(-4)}`;
  const row = await prisma.apiToken.create({
    data: {
      id: generateId("tok", 12),
      userId,
      name: name?.trim() || "API token",
      tokenHash: hashToken(token),
      tokenPreview: preview,
    },
  });
  return { id: row.id, token, preview };
}

export async function userFromApiToken(token: string): Promise<User | null> {
  if (!token.startsWith(API_PREFIX)) return null;
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row || row.revokedAt) return null;
  const stale = !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000;
  if (stale) {
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return row.user;
}

export function githubOAuthEnabled(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export async function upsertGithubUser(input: { githubId: string; email: string; name: string | null }): Promise<User> {
  const email = assertEmail(input.email);
  const byGithub = await prisma.user.findUnique({ where: { githubId: input.githubId } });
  if (byGithub) return byGithub;
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    if (byEmail.githubId && byEmail.githubId !== input.githubId) {
      throw new HttpError(409, "That email is already linked to a different GitHub account.");
    }
    return prisma.user.update({
      where: { id: byEmail.id },
      data: { githubId: input.githubId, name: byEmail.name ?? input.name },
    });
  }
  return prisma.user.create({
    data: {
      id: generateId("usr", 12),
      email,
      name: input.name,
      githubId: input.githubId,
    },
  });
}
