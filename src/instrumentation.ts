/**
 * يبدأ عامل المهام داخل خادم Next (Node فقط) كل 15 ثانية.
 * في بيئات لا تدعم العمليات الدائمة: عطّل RUN_WORKER واستدعِ /api/cron?key=CRON_SECRET من خدمة cron.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if ((process.env.RUN_WORKER ?? "true") !== "true") return;
  // على Vercel (دوال مؤقتة) يعمل العامل عبر Vercel Cron على /api/cron
  if (process.env.VERCEL) return;
  const g = globalThis as unknown as { __wafdaWorker?: NodeJS.Timeout };
  if (g.__wafdaWorker) return;
  const { workerTick } = await import("./services/worker");
  const { ensureDbReady } = await import("./lib/db");
  await ensureDbReady();
  g.__wafdaWorker = setInterval(() => {
    workerTick().catch((e) => console.error("[worker]", e));
  }, 15_000);
  console.log("[wafda] worker started (15s)");
}
