import { cleanupExpiredEvents } from "@/lib/cleanup";
import { errorResponse, json } from "@/lib/http";
import { timingSafeEqualString } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.get("authorization") ?? "";
    const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!secret || !provided || !timingSafeEqualString(provided, secret)) {
      return json({ error: "Unauthorized." }, 401);
    }
    const result = await cleanupExpiredEvents();
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
