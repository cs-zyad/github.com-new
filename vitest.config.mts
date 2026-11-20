import { defineConfig } from "vitest/config";
import path from "node:path";

// الاختبارات تعمل على محاكي Firestore الرسمي (لا تمس أي قاعدة حقيقية):
//   npm test   ← يشغّل المحاكي ثم الاختبارات داخله
const emulator = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: "./tests/global-setup.ts",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      FIRESTORE_EMULATOR_HOST: emulator,
      FIREBASE_PROJECT_ID: "demo-wafda-test",
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
