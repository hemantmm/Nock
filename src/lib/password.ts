import bcrypt from "bcryptjs";

function rounds(): number {
  const value = Number(process.env.BCRYPT_COST ?? 12);
  if (!Number.isInteger(value) || value < 4 || value > 15) return 12;
  return value;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, rounds());
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
