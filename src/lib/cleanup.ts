import { prisma } from "./db";

const globalCleanup = globalThis as typeof globalThis & {
  __hooktraceCleanup?: ReturnType<typeof setInterval>;
};

export async function cleanupExpiredEvents(): Promise<{ deleted: number }> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM "Event" AS e
    USING "Endpoint" AS p
    WHERE e."endpointId" = p.id
      AND e."createdAt" < NOW() - (p."retentionDays" * INTERVAL '1 day')
  `;
  return { deleted: Number(deleted) };
}

export function startCleanupScheduler(): void {
  if (globalCleanup.__hooktraceCleanup) return;
  const run = () => {
    void cleanupExpiredEvents().catch((error: unknown) => {
      console.error(error instanceof Error ? `cleanup failed: ${error.message}` : "cleanup failed");
    });
  };
  const kick = setTimeout(run, 20_000);
  const timer = setInterval(run, 60 * 60 * 1000);
  kick.unref();
  timer.unref();
  globalCleanup.__hooktraceCleanup = timer;
}
