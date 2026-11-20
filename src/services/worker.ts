import { processOutbox } from "./messaging";
import { runDueJobs } from "./sending";
import { expireOffers } from "./rsvp";

let running = false;

/** دورة واحدة للعامل: التذكيرات المجدولة، طابور الرسائل، وانتهاء فرص الانتظار */
export async function workerTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const jobs = await runDueJobs();
    const outbox = await processOutbox(200);
    const expired = await expireOffers();
    return { skipped: false, jobs, outbox, expired };
  } finally {
    running = false;
  }
}
