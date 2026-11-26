import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
