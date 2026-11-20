// تشغيل اختبار الرحلة الكاملة في متصفح حقيقي:
// قاعدة بيانات جديدة ← بيانات تجريبية ← خادم إنتاج ← سيناريو Playwright ← إيقاف الخادم.
// الاستخدام: npm run build && npm run e2e
import { execSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const port = Number(process.env.E2E_PORT || 3210);
const dbFile = path.join(os.tmpdir(), `wafda-e2e-${Date.now()}.db`);
const env = {
  ...process.env,
  DATABASE_URL: `file:${dbFile}?connection_limit=1`,
  APP_URL: `http://localhost:${port}`,
  DEMO_MODE: "true",
  RUN_WORKER: "true",
  WHATSAPP_PROVIDER: "mock",
  EMAIL_PROVIDER: "mock",
  PAYMENT_PROVIDER: "mock",
  PAYMENT_WEBHOOK_SECRET: "e2e-secret",
  CRON_SECRET: "e2e-cron",
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
};

execSync("npx prisma db push --skip-generate", { stdio: "inherit", env });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });

// المنفذ يجب أن يكون متاحًا حتى لا نختبر خادمًا قديمًا
try {
  await fetch(`http://localhost:${port}/login`);
  console.error(`المنفذ ${port} مستخدم. أوقف الخادم القديم أو غيّر E2E_PORT.`);
  process.exit(1);
} catch {}

// تشغيل Next مباشرة (بدون npx) في مجموعة عمليات مستقلة لإيقافها بالكامل
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/login`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start\n" + serverLog);
}

let code = 0;
try {
  await waitReady();
  execSync(`node e2e/flow.mjs`, { stdio: "inherit", timeout: 300_000, env: { ...env, BASE_URL: `http://localhost:${port}`, E2E_DB: dbFile } });
} catch (e) {
  code = 1;
  console.error("\n--- server log (tail) ---\n" + serverLog.split("\n").slice(-60).join("\n"));
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  try {
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(dbFile + "-wal", { force: true });
    fs.rmSync(dbFile + "-shm", { force: true });
  } catch {}
}
process.exit(code);
