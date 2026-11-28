import { z } from "zod";
import { HttpError } from "./http";

const providerSchema = z.enum(["stripe", "github", "razorpay", "shopify", "slack", "svix", "hmac_sha256"]);
const encodingSchema = z.enum(["hex", "prefixed_hex", "base64"]);

const contentType = z
  .string()
  .max(160)
  .regex(/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:\s*;\s*[\w!#$&^_.+-]+=(?:[\w!#$&^_.+-]+|"[^"\\]{0,80}"))*$/);

export const createEndpointSchema = z.object({
  name: z.string().max(80).optional(),
});

export const updateEndpointSchema = z.object({
  name: z.string().max(80).optional(),
  responseStatus: z.number().int().min(100).max(599).optional(),
  responseBody: z.string().max(16_000).optional(),
  responseContentType: contentType.optional(),
  signingProvider: providerSchema.nullable().optional(),
  signingSecret: z.string().max(512).nullable().optional(),
  signingHeader: z
    .string()
    .max(80)
    .regex(/^[A-Za-z0-9-]*$/)
    .nullable()
    .optional(),
  signingEncoding: encodingSchema.optional(),
  timestampHeader: z
    .string()
    .max(80)
    .regex(/^[A-Za-z0-9-]*$/)
    .nullable()
    .optional(),
  toleranceSeconds: z.number().int().min(0).max(86_400).optional(),
  retentionDays: z.number().int().min(1).max(30).optional(),
  burstThreshold: z.number().int().min(0).max(100_000).optional(),
});

const timeString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid time.")
  .optional();

export const listEventsSchema = z.object({
  method: z.string().max(16).optional(),
  status: z
    .string()
    .regex(/^\d{3}$/)
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  verification: z.enum(["valid", "invalid", "none"]).optional(),
  q: z.string().max(200, "Search must be 200 characters or fewer.").optional(),
  from: timeString,
  to: timeString,
  cursor: z.string().max(200).optional(),
});

export const replaySchema = z.object({
  targetUrl: z.string().min(1).max(2000),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  headers: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        value: z.string().max(8_000),
      }),
    )
    .max(80)
    .optional(),
  body: z.string().max(1_200_000).optional(),
  includeSensitive: z.boolean().optional(),
});

export const sampleSchema = z.object({
  provider: z.enum(["plain", "stripe", "github", "razorpay", "shopify", "slack", "svix"]),
});

export const forwardReportSchema = z.object({
  targetUrl: z.string().min(1).max(2000),
  method: z.string().min(1).max(12),
  responseStatus: z.number().int().min(100).max(599).nullable(),
  latencyMs: z.number().int().min(0).max(120_000),
  error: z.string().max(500).nullable(),
  responseBody: z.string().max(65_536).nullable(),
  responseTruncated: z.boolean().optional(),
  responseHeaders: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        value: z.string().max(4_000),
      }),
    )
    .max(40)
    .optional(),
});

export function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).slice(0, 3).join(" ");
    throw new HttpError(400, message || "Invalid request.");
  }
  return parsed.data;
}
