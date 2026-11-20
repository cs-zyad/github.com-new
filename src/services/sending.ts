import { C, col, ref, getDoc, getDocs, getMany, newId, runTx, txGet } from "@/lib/firestore";
import type { Event, Invitation, Registration, ScheduledJob } from "@/lib/types";
import { AppError, NotFoundError } from "@/lib/errors";
import { getSettings, type OperatingSettings } from "@/lib/settings";
import { audit, auditTx } from "@/lib/audit";
import { availableSeats, getOwnedEvent, requiredPrivatePlaces } from "./events";
import { channelsOf } from "./invitations";
import { composeInvitation, composeWaitlistOffer } from "./compose";
import { enqueueWalletBatch, estimateCost, kickOutbox, type OutgoingItem } from "./messaging";
import { InsufficientBalanceError, getBalance } from "./wallet";

export type SendTarget = "NOT_SENT" | "FAILED" | "SELECTED";

function buildInviteItems(event: Event, invs: Invitation[], kind: "INVITATION" | "REMINDER"): OutgoingItem[] {
  const items: OutgoingItem[] = [];
  for (const inv of invs) {
    const msg = composeInvitation(event, inv, kind);
    for (const ch of channelsOf(inv)) {
      items.push({
        key: `${inv.id}:${ch.channel}`,
        channel: ch.channel,
        recipient: ch.recipient,
        subject: msg.subject,
        body: msg.body,
        invitationId: inv.id,
      });
    }
  }
  return items;
}

async function assertCanSendInvitations(event: Event) {
  if (event.mode !== "PRIVATE") throw new AppError("الإرسال متاح للفعاليات ذات الدعوات الخاصة");
  if (event.status !== "ACTIVE") throw new AppError("ادفع الباقة أولًا لتفعيل الإرسال");
  const required = await requiredPrivatePlaces(event.id);
  if (required > event.paidPlaces) {
    throw new AppError(
      `عدد الأماكن المطلوبة (${required}) أكبر من أماكن الباقة المدفوعة (${event.paidPlaces}). اشترِ ${
        required - event.paidPlaces
      } مكانًا إضافيًا قبل الإرسال.`,
    );
  }
}

const byCreated = (a: { createdAt: Date }, b: { createdAt: Date }) => a.createdAt.getTime() - b.createdAt.getTime();

async function invitationsForTarget(eventId: string, target: SendTarget, ids?: string[]) {
  if (target === "SELECTED") {
    if (!ids?.length) throw new AppError("اختر مدعوًا واحدًا على الأقل");
    return (await getMany<Invitation>(C.invitations, ids)).filter((i) => i.eventId === eventId).sort(byCreated);
  }
  return (await getDocs<Invitation>(col(C.invitations).where("eventId", "==", eventId).where("deliveryStatus", "==", target))).sort(byCreated);
}

export async function previewInvitationSend(ownerId: string, eventId: string, target: SendTarget, ids?: string[]) {
  const event = await getOwnedEvent(eventId, ownerId);
  const settings = await getSettings();
  const invs = await invitationsForTarget(event.id, target, ids);
  const items = buildInviteItems(event, invs, "INVITATION");
  const cost = estimateCost(settings, items);
  const balance = await getBalance(ownerId);
  return { recipients: invs.length, ...cost, balance, enough: balance >= cost.total, settings };
}

export async function sendInvitations(
  ownerId: string,
  eventId: string,
  params: { target: SendTarget; invitationIds?: string[]; batchKey: string },
) {
  const event = await getOwnedEvent(eventId, ownerId);
  await assertCanSendInvitations(event);
  const settings = await getSettings();
  const invs = await invitationsForTarget(event.id, params.target, params.invitationIds);
  if (invs.length === 0) throw new AppError("لا يوجد مدعوون للإرسال في هذا الاختيار");
  const items = buildInviteItems(event, invs, "INVITATION");
  const result = await enqueueWalletBatch({
    ownerId,
    eventId: event.id,
    kind: "INVITATION",
    batchKey: `inv:${event.id}:${params.batchKey}`,
    items,
    settings,
  });
  await audit({
    actorId: ownerId,
    action: "invitation.send",
    entityType: "Event",
    entityId: event.id,
    meta: { queued: result.queued, cost: result.totalCost, duplicate: result.duplicate },
  });
  await kickOutbox();
  return result;
}

// ───────── التذكيرات ─────────

/** من يحتاج تذكيرًا الآن: وصلته الدعوة ولم يرد بعد (لا تأكيد ولا اعتذار ولا انتظار) */
export async function reminderRecipients(eventId: string) {
  return (
    await getDocs<Invitation>(
      col(C.invitations).where("eventId", "==", eventId).where("deliveryStatus", "==", "SENT").where("regStatus", "==", null),
    )
  ).sort(byCreated);
}

export async function previewReminder(ownerId: string, eventId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  const settings = await getSettings();
  const invs = await reminderRecipients(event.id);
  const items = buildInviteItems(event, invs, "REMINDER");
  const cost = estimateCost(settings, items);
  const balance = await getBalance(ownerId);
  return { recipients: invs.length, ...cost, balance, enough: balance >= cost.total };
}

async function runReminder(
  event: Event,
  ownerId: string,
  batchKey: string,
  settings: OperatingSettings,
  trigger: "MANUAL" | "SCHEDULED",
  scheduledJobId?: string,
) {
  const invs = await reminderRecipients(event.id);
  if (invs.length === 0) return { recipients: 0, queued: 0, skipped: 0, totalCost: 0, duplicate: false, batchId: null };
  const items = buildInviteItems(event, invs, "REMINDER");
  const r = await enqueueWalletBatch({
    ownerId,
    eventId: event.id,
    kind: "REMINDER",
    batchKey,
    items,
    trigger,
    scheduledJobId,
    settings,
  });
  return { recipients: invs.length, ...r };
}

export async function sendReminderNow(ownerId: string, eventId: string, batchKey: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status !== "ACTIVE") throw new AppError("الفعالية غير نشطة");
  const settings = await getSettings();
  const r = await runReminder(event, ownerId, `rem:${event.id}:${batchKey}`, settings, "MANUAL");
  if (r.recipients === 0) throw new AppError("لا يوجد مدعوون بحاجة لتذكير الآن");
  await kickOutbox();
  return r;
}

export async function scheduleReminder(ownerId: string, eventId: string, runAt: Date) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status !== "ACTIVE") throw new AppError("ادفع الباقة وأرسل الدعوات أولًا");
  if (runAt.getTime() < Date.now() + 60_000) throw new AppError("اختر وقتًا في المستقبل");
  if (runAt > event.startsAt) throw new AppError("موعد التذكير يجب أن يكون قبل بداية الفعالية");
  const preview = await previewReminder(ownerId, eventId);
  const job: ScheduledJob = {
    id: newId(),
    type: "REMINDER",
    ownerId,
    eventId: event.id,
    runAt,
    status: "PENDING",
    payload: "{}",
    result: null,
    estimatedCost: preview.total,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
  };
  const { id: jobId, ...jobData } = job;
  await ref(C.scheduledJobs, jobId).set(jobData);
  await audit({ actorId: ownerId, action: "reminder.schedule", entityType: "ScheduledJob", entityId: job.id });
  return { job, preview };
}

export async function cancelScheduledReminder(ownerId: string, jobId: string) {
  const ok = await runTx(async (tx) => {
    const job = await txGet<ScheduledJob>(tx, ref(C.scheduledJobs, jobId));
    if (!job || job.ownerId !== ownerId || job.status !== "PENDING") return false;
    tx.update(ref(C.scheduledJobs, jobId), { status: "CANCELLED", finishedAt: new Date() });
    return true;
  });
  if (!ok) throw new NotFoundError("التذكير غير موجود أو نُفّذ مسبقًا");
}

/** تنفيذ المهام المستحقة — كل مهمة تُحجز بتحديث شرطي فلا تُنفّذ مرتين */
export async function runDueJobs() {
  const settings = await getSettings();
  const now = Date.now();
  const due = (await getDocs<ScheduledJob>(col(C.scheduledJobs).where("status", "==", "PENDING")))
    .filter((j) => j.runAt.getTime() <= now)
    .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
    .slice(0, 20);
  let done = 0;
  for (const job of due) {
    // حجز المهمة بمعاملة: لا تُنفّذ مرتين حتى مع عاملين متوازيين
    const claimed = await runTx(async (tx) => {
      const cur = await txGet<ScheduledJob>(tx, ref(C.scheduledJobs, job.id));
      if (!cur || cur.status !== "PENDING") return false;
      tx.update(ref(C.scheduledJobs, job.id), { status: "RUNNING", startedAt: new Date() });
      return true;
    });
    if (!claimed) continue;
    const finish = (status: string, result: unknown) =>
      ref(C.scheduledJobs, job.id).update({ status, result: JSON.stringify(result), finishedAt: new Date() });
    try {
      const event = await getDoc<Event>(C.events, job.eventId);
      if (!event || event.status !== "ACTIVE") {
        await finish("CANCELLED", { reason: "الفعالية غير نشطة" });
        continue;
      }
      // فحص الحالة الحالية لحظة التنفيذ: يصل التذكير فقط لمن لا يزال بحاجة للتأكيد
      const r = await runReminder(event, job.ownerId, `job:${job.id}`, settings, "SCHEDULED", job.id);
      await finish("DONE", { recipients: r.recipients, queued: r.queued, skipped: r.skipped, cost: r.totalCost });
      done++;
    } catch (e) {
      if (e instanceof InsufficientBalanceError) {
        await finish("FAILED", { reason: "INSUFFICIENT_BALANCE", required: e.required, balance: e.balance, message: e.message });
      } else {
        await finish("FAILED", { reason: "ERROR", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  if (done) await kickOutbox();
  return done;
}

// ───────── قائمة الانتظار ─────────

export async function offerWaitlistSpot(ownerId: string, registrationId: string, batchKey: string) {
  const reg = await getDoc<Registration>(C.registrations, registrationId);
  const event = reg ? await getDoc<Event>(C.events, reg.eventId) : null;
  if (!reg || !event || event.ownerId !== ownerId) throw new NotFoundError("التسجيل غير موجود");
  if (reg.status !== "WAITLISTED") throw new AppError("هذا الشخص ليس في قائمة الانتظار");
  if (event.status !== "ACTIVE") throw new AppError("الفعالية غير نشطة");
  const free = availableSeats(event);
  if (free < 1) throw new AppError("لا توجد مقاعد متاحة حاليًا. يتوفر مقعد عند اعتذار ضيف أو زيادة السعة.");
  const settings = await getSettings();
  const recipient = reg.contactMethod === "WHATSAPP" ? reg.phone : reg.email;
  if (!recipient) throw new AppError("لا توجد وسيلة تواصل لهذا الشخص");
  const expires = new Date(Date.now() + settings.waitlistOfferHours * 3600 * 1000);

  const msg = composeWaitlistOffer(event, { ...reg, offerExpiresAt: expires }, settings.waitlistOfferHours);
  // تحويل الحالة إلى «أُرسلت له فرصة» والخصم في نفس المعاملة: إن لم يكفِ الرصيد لا تتغير الحالة
  const result = await enqueueWalletBatch({
    ownerId,
    eventId: event.id,
    kind: "WAITLIST_OFFER",
    batchKey: `offer:${reg.id}:${batchKey}`,
    items: [
      {
        key: reg.id,
        channel: reg.contactMethod as "WHATSAPP" | "EMAIL",
        recipient,
        subject: msg.subject,
        body: msg.body,
        registrationId: reg.id,
      },
    ],
    settings,
    extra: async (tx) => {
      const cur = await txGet<Registration>(tx, ref(C.registrations, reg.id));
      return () => {
        if (!cur || cur.status !== "WAITLISTED") throw new AppError("تغيّرت حالة هذا الشخص للتو. حدّث الصفحة.");
        const now = new Date();
        tx.update(ref(C.registrations, reg.id), { status: "OFFERED", offeredAt: now, offerExpiresAt: expires, version: cur.version + 1, updatedAt: now });
        if (cur.invitationId) tx.update(ref(C.invitations, cur.invitationId), { regStatus: "OFFERED", updatedAt: now });
        auditTx(tx, { actorId: ownerId, action: "waitlist.offer", entityType: "Registration", entityId: reg.id });
      };
    },
  });
  await kickOutbox();
  return { ...result, free, expires };
}
