import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";

// قاعدة بيانات جديدة فارغة لكل تشغيل اختبارات (لا تمس قاعدة التطوير)
const dbUrl =
  process.env.TEST_DATABASE_URL ??
  `file:${path.join(os.tmpdir(), `wafda-test-${process.pid}-${Date.now()}.db`)}?connection_limit=1`;
process.env.WAFDA_TEST_DB_URL = dbUrl;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: "./tests/global-setup.ts",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: dbUrl,
      APP_URL: "http://localhost:3000",
      DEMO_MODE: "true",
      WHATSAPP_PROVIDER: "mock",
      EMAIL_PROVIDER: "mock",
      PAYMENT_PROVIDER: "mock",
      PAYMENT_WEBHOOK_SECRET: "test-secret",
      RUN_WORKER: "false",
    },
  },
});
