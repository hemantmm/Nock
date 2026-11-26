export type ProviderId = "stripe" | "github" | "razorpay" | "shopify" | "slack" | "svix" | "hmac_sha256";

export type SigningEncoding = "hex" | "prefixed_hex" | "base64";

export type VerificationReason =
  | "ok"
  | "missing_header"
  | "malformed_header"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch"
  | "wrong_secret"
  | "body_modified"
  | "encoding_mismatch"
  | "legacy_scheme_only"
  | "secret_whitespace"
  | "secret_unavailable";

export type CheckState = "pass" | "fail" | "skip";

export type VerificationCheck = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
};

export type VerificationResult = {
  status: "valid" | "invalid";
  provider: ProviderId;
  reason: VerificationReason;
  summary: string;
  detail: string;
  checks: VerificationCheck[];
};

export type HeaderPair = {
  name: string;
  value: string;
};

export type EventSummary = {
  id: string;
  method: string;
  path: string;
  query: HeaderPair[];
  contentType: string | null;
  bodyPreview: string;
  bodySize: number;
  bodyTruncated: boolean;
  sourceIp: string | null;
  responseStatus: number;
  verification: VerificationResult | null;
  createdAt: string;
};

export type ReplayView = {
  id: string;
  targetUrl: string;
  method: string;
  requestHeaders: HeaderPair[];
  responseStatus: number | null;
  responseHeaders: HeaderPair[];
  responseBodyText: string | null;
  responseTruncated: boolean;
  latencyMs: number | null;
  error: string | null;
  source: "replay" | "forward";
  createdAt: string;
};

export type EventDetail = EventSummary & {
  headers: HeaderPair[];
  bodyText: string | null;
  bodyBase64: string;
  replays: ReplayView[];
};

export type EndpointView = {
  id: string;
  name: string;
  hookPath: string;
  responseStatus: number;
  responseBody: string;
  responseContentType: string;
  signingProvider: ProviderId | null;
  hasSigningSecret: boolean;
  signingSecretPreview: string | null;
  signingHeader: string | null;
  signingEncoding: SigningEncoding;
  timestampHeader: string | null;
  toleranceSeconds: number;
  retentionDays: number;
  createdAt: string;
};

export type EndpointCreated = EndpointView & {
  token: string;
};
