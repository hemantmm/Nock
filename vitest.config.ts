import { defineConfig } from "vitest/config";
import path from "node:path";

process.env.DATABASE_URL ??=
  "postgresql://hooktrace:hooktrace@127.0.0.1:54329/hooktrace_test?schema=public";
process.env.HOOKTRACE_ENCRYPTION_KEY ??= "test-encryption-key-hooktrace";
process.env.HOOKTRACE_ALLOW_PRIVATE_TARGETS ??= "false";
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.BCRYPT_COST ??= "4";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
