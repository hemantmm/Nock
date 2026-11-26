import crypto from "node:crypto";

export function hmacSha256(secret: string | Buffer, message: Buffer): Buffer {
  return crypto.createHmac("sha256", secret).update(message).digest();
}

export function hmacSha1(secret: string, message: Buffer): Buffer {
  return crypto.createHmac("sha1", secret).update(message).digest();
}

export function sha256Hex(message: Buffer): string {
  return crypto.createHash("sha256").update(message).digest("hex");
}

export function timingSafeEqualBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function decodeHex(value: string): Buffer | null {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) return null;
  return Buffer.from(value, "hex");
}

export function shortDigest(hex: string): string {
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function generateId(prefix: string, bytes = 18): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
