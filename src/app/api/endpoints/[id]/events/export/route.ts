import { requireEndpoint } from "@/lib/endpoints";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const EXPORT_LIMIT = 5_000;
const EXPORT_BODY_BYTES_LIMIT = 50 * 1024 * 1024;

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const endpoint = await requireEndpoint(req, id);
    if (!endpoint) return json({ error: "Endpoint not found." }, 404);
    const format = new URL(req.url).searchParams.get("format") ?? "json";
    if (format !== "json" && format !== "csv") throw new HttpError(400, "Format must be json or csv.");

    const [eventCount, bodyStats] = await Promise.all([
      prisma.event.count({ where: { endpointId: endpoint.id } }),
      prisma.event.aggregate({ where: { endpointId: endpoint.id }, _sum: { bodySize: true } }),
    ]);
    if (eventCount > EXPORT_LIMIT) {
      throw new HttpError(413, `Export is limited to ${EXPORT_LIMIT.toLocaleString()} requests. Clear older requests before exporting.`);
    }
    if ((bodyStats._sum.bodySize ?? 0) > EXPORT_BODY_BYTES_LIMIT) {
      throw new HttpError(413, "Export exceeds the 50 MB raw body limit. Clear older requests before exporting.");
    }
    const events = await prisma.event.findMany({
      where: { endpointId: endpoint.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: EXPORT_LIMIT,
    });
    const rows = events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt.toISOString(),
      method: event.method,
      path: event.path,
      query: event.query,
      headers: event.headers,
      bodyText: event.bodyText,
      bodyBase64: Buffer.from(event.body).toString("base64"),
      bodySize: event.bodySize,
      bodyTruncated: event.bodyTruncated,
      contentType: event.contentType,
      sourceIp: event.sourceIp,
      responseStatus: event.responseStatus,
      verificationStatus: event.verificationStatus,
      verification: event.verification,
    }));

    if (format === "json") {
      return new Response(JSON.stringify({ endpointId: endpoint.id, exportedAt: new Date().toISOString(), events: rows }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="hooktrace-${endpoint.id}-events.json"`,
          "cache-control": "no-store",
        },
      });
    }
    const columns = ["id", "createdAt", "method", "path", "query", "headers", "bodyText", "bodyBase64", "bodySize", "bodyTruncated", "contentType", "sourceIp", "responseStatus", "verificationStatus", "verification"] as const;
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n");
    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="hooktrace-${endpoint.id}-events.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe = /^[\s]*[=+@\-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
