ALTER TABLE "Endpoint" ADD COLUMN "burstThreshold" INTEGER NOT NULL DEFAULT 20;

CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");
CREATE INDEX "Alert_endpointId_createdAt_idx" ON "Alert"("endpointId", "createdAt" DESC);
CREATE INDEX "Alert_endpointId_readAt_idx" ON "Alert"("endpointId", "readAt");

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
