/**
 * تشغيل العامل كعملية مستقلة (بديل عن العامل المدمج في خادم Next):
 *   RUN_WORKER=false npm start   ← في عملية
 *   npm run worker               ← في عملية أخرى
 * مع PostgreSQL فقط — SQLite يُفضّل معها العامل المدمج (عملية واحدة).
 */
import { workerTick } from "../src/services/worker";

async function main() {
  console.log("[worker] started");
  for (;;) {
    try {
      const r = await workerTick();
      if (!r.skipped && (r.jobs || r.outbox?.sent || r.outbox?.failed || r.expired)) console.log("[worker]", JSON.stringify(r));
    } catch (e) {
      console.error("[worker]", e);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

main();
