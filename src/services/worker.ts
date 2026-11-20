import { processOutbox, repairPendingBatches } from "./messaging";
import { runDueJobs } from "./sending";
import { expireOffers } from "./rsvp";

let running = false;

/** دورة واحدة للعامل: إكمال الدفعات المعلّقة، التذكيرات المجدولة، طابور الرسائل، وانتهاء فرص الانتظار */
export async function workerTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const batches = await repairPendingBatches();
    const jobs = await runDueJobs();
    const outbox = await processOutbox(200);
    const expired = await expireOffers();
    return { skipped: false, batches, jobs, outbox, expired };
  } finally {
    running = false;
  }
}
