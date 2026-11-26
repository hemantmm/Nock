-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "ownerTokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL DEFAULT 200,
    "responseBody" TEXT NOT NULL DEFAULT '{"received":true}',
    "responseContentType" TEXT NOT NULL DEFAULT 'application/json; charset=utf-8',
    "signingProvider" TEXT,
    "signingSecretEnc" TEXT,
    "signingHeader" TEXT,
    "signingEncoding" TEXT NOT NULL DEFAULT 'hex',
    "timestampHeader" TEXT,
    "toleranceSeconds" INTEGER NOT NULL DEFAULT 300,
    "retentionDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "headersText" TEXT NOT NULL,
    "body" BYTEA NOT NULL,
    "bodyText" TEXT,
    "bodySize" INTEGER NOT NULL,
    "bodyTruncated" BOOLEAN NOT NULL DEFAULT false,
    "contentType" TEXT,
    "sourceIp" TEXT,
    "responseStatus" INTEGER NOT NULL,
    "verificationStatus" TEXT,
    "verification" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Replay" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "requestHeaders" JSONB NOT NULL,
    "requestBody" BYTEA NOT NULL,
    "responseStatus" INTEGER,
    "responseHeaders" JSONB,
    "responseBody" BYTEA,
    "responseTruncated" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Replay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_endpointId_createdAt_idx" ON "Event"("endpointId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Event_endpointId_verificationStatus_idx" ON "Event"("endpointId", "verificationStatus");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- CreateIndex
CREATE INDEX "Replay_eventId_createdAt_idx" ON "Replay"("eventId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Replay" ADD CONSTRAINT "Replay_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

