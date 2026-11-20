// تشغيل اختبار الرحلة الكاملة في متصفح حقيقي:
// محاكي Firestore (مشروع جديد باسم فريد لكل تشغيل) ← بيانات تجريبية ← خادم إنتاج ← سيناريو Playwright ← إيقاف.
// الاستخدام: npm run build && npm run e2e   (يحتاج Java للمحاكي)
import { execSync, spawn } from "node:child_process";

const port = Number(process.env.E2E_PORT || 3210);
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const env = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: emulatorHost,
  FIREBASE_PROJECT_ID: `demo-wafda-e2e-${Date.now()}`,
  APP_URL: `http://localhost:${port}`,
  DEMO_MODE: "true",
  RUN_WORKER: "true",
  WHATSAPP_PROVIDER: "mock",
  EMAIL_PROVIDER: "mock",
  PAYMENT_PROVIDER: "mock",
  PAYMENT_WEBHOOK_SECRET: "e2e-secret",
  CRON_SECRET: "e2e-cron",
};

// تشغيل المحاكي إن لم يكن يعمل
let emulator = null;
async function emulatorUp() {
  try {
    return (await fetch(`http://${emulatorHost}/`)).ok;
  } catch {
    return false;
  }
}
if (!(await emulatorUp())) {
  emulator = spawn("npx", ["-y", "firebase-tools@15.37.0", "emulators:start", "--only", "firestore", "--project", "demo-wafda"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  for (let i = 0; i < 120 && !(await emulatorUp()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await emulatorUp())) {
    console.error("تعذّر تشغيل محاكي Firestore (يحتاج Java 11+)");
    process.exit(1);
  }
}

execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env });

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
  execSync(`node e2e/flow.mjs`, { stdio: "inherit", timeout: 300_000, env: { ...env, BASE_URL: `http://localhost:${port}` } });
} catch (e) {
  code = 1;
  console.error("\n--- server log (tail) ---\n" + serverLog.split("\n").slice(-60).join("\n"));
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  if (emulator) {
    try {
      process.kill(-emulator.pid, "SIGTERM");
    } catch {}
  }
}
process.exit(code);
