import crypto from "node:crypto";

const DEV_KEY_MATERIAL = "hooktrace-development-key-not-for-production";

function encryptionKey(): Buffer {
  const raw = process.env.HOOKTRACE_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("HOOKTRACE_ENCRYPTION_KEY is required in production.");
    }
    return crypto.createHash("sha256").update(DEV_KEY_MATERIAL).digest();
  }
  const asBase64 = Buffer.from(raw, "base64");
  if (asBase64.length === 32 && raw.length >= 43) return asBase64;
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(
    ":",
  );
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(":");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new Error("Signing secret is stored in an unknown format.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

export function secretPreview(secret: string): string {
  if (secret.length <= 4) return "••••";
  return `••••${secret.slice(-4)}`;
}
