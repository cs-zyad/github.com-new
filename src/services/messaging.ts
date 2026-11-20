import { prisma, withTx, type Db, type Tx } from "@/lib/db";
import { getSettings, type OperatingSettings } from "@/lib/settings";
import { getMessageProvider } from "@/providers/messaging";
import { creditWallet, debitWallet, InsufficientBalanceError } from "./wallet";
import type { Channel } from "@/lib/constants";

export type OutgoingItem = {
  /** مفتاح فريد للعنصر داخل الدفعة (مثل invitationId:channel) */
  key: string;
  channel: Channel;
  recipient: string;
  subject?: string;
  body: string;
  invitationId?: string;
  registrationId?: string;
};

export function messageCost(settings: OperatingSettings, channel: Channel): number {
  return settings.messagePrice[channel] ?? 0;
}

export function estimateCost(settings: OperatingSettings, items: { channel: Channel }[]) {
  const byChannel = { WHATSAPP: 0, EMAIL: 0 } as Record<Channel, number>;
  for (const it of items) byChannel[it.channel]++;
  const total = items.reduce((s, it) => s + messageCost(settings, it.channel), 0);
  return { total, count: items.length, byChannel };
}

export type EnqueueResult = {
  batchId: string;
  duplicate: boolean;
  queued: number;
  skipped: number;
  totalCost: number;
};

/**
 * إنشاء دفعة رسائل تُخصم من رصيد الرسائل.
 * - مفتاح الدفعة يمنع التكرار عند الضغط المتكرر أو إعادة الطلب.
 * - سياسة الرصيد غير الكافي من الإعدادات: BLOCK (لا يُرسل شيء) أو SEND_AFFORDABLE (يُرسل ما يغطيه الرصيد).
 * يجب استدعاؤها داخل معاملة.
 */
export async function enqueueWalletBatch(
  tx: Tx,
  params: {
    ownerId: string;
    eventId: string;
    kind: "INVITATION" | "REMINDER" | "WAITLIST_OFFER";
    batchKey: string;
    items: OutgoingItem[];
    trigger?: "MANUAL" | "SCHEDULED";
    scheduledJobId?: string;
    settings: OperatingSettings;
  },
): Promise<EnqueueResult> {
  const existing = await tx.messageBatch.findUnique({ where: { idempotencyKey: params.batchKey } });
  if (existing) {
    return { batchId: existing.id, duplicate: true, queued: existing.messageCount, skipped: 0, totalCost: existing.totalCost };
  }

  let items = params.items;
  let total = items.reduce((s, it) => s + messageCost(params.settings, it.channel), 0);

  if (params.settings.insufficientBalancePolicy === "SEND_AFFORDABLE") {
    const wallet = await tx.wallet.findUnique({ where: { userId: params.ownerId } });
    let balance = wallet?.balance ?? 0;
    if (balance < total) {
      const affordable: OutgoingItem[] = [];
      for (const it of items) {
        const c = messageCost(params.settings, it.channel);
        if (c <= balance) {
          affordable.push(it);
          balance -= c;
        }
      }
      if (affordable.length === 0) throw new InsufficientBalanceError(total, wallet?.balance ?? 0);
      items = affordable;
      total = items.reduce((s, it) => s + messageCost(params.settings, it.channel), 0);
    }
  }

  const batch = await tx.messageBatch.create({
    data: {
      ownerId: params.ownerId,
      eventId: params.eventId,
      kind: params.kind,
      idempotencyKey: params.batchKey,
      recipientCount: new Set(items.map((i) => i.invitationId ?? i.registrationId ?? i.recipient)).size,
      messageCount: items.length,
      totalCost: total,
      trigger: params.trigger ?? "MANUAL",
      scheduledJobId: params.scheduledJobId,
    },
  });

  // الخصم الذرّي — يرمي InsufficientBalanceError عند عدم الكفاية فتُلغى المعاملة كاملة
  await debitWallet(tx, {
    userId: params.ownerId,
    amount: total,
    description: `${kindText(params.kind)}: ${items.length} رسالة`,
    idempotencyKey: `batch:${batch.id}`,
    batchId: batch.id,
  });

  if (items.length) {
    await tx.message.createMany({
      data: items.map((it) => ({
        ownerId: params.ownerId,
        eventId: params.eventId,
        batchId: batch.id,
        invitationId: it.invitationId,
        registrationId: it.registrationId,
        kind: params.kind,
        channel: it.channel,
        recipient: it.recipient,
        subject: it.subject,
        body: it.body,
        billing: "WALLET",
        cost: messageCost(params.settings, it.channel),
        idempotencyKey: `${batch.id}:${it.key}`,
      })),
    });
  }

  if (params.kind === "INVITATION") {
    const invIds = [...new Set(items.map((i) => i.invitationId).filter(Boolean))] as string[];
    if (invIds.length) {
      await tx.invitation.updateMany({
        where: { id: { in: invIds }, deliveryStatus: { in: ["NOT_SENT", "FAILED"] } },
        data: { deliveryStatus: "QUEUED" },
      });
    }
  }

  return {
    batchId: batch.id,
    duplicate: false,
    queued: items.length,
    skipped: params.items.length - items.length,
    totalCost: total,
  };
}

function kindText(kind: string) {
  return kind === "INVITATION" ? "إرسال دعوات" : kind === "REMINDER" ? "تذكير" : "فرصة قائمة الانتظار";
}

/**
 * رسالة مشمولة في الباقة (تأكيد الحضور مع التذكرة) — لا تُخصم من رصيد الرسائل،
 * وتُسجّل لها تكلفة تشغيل تقديرية معزولة محاسبيًا.
 */
export async function enqueuePackageMessage(
  db: Db,
  params: {
    ownerId: string;
    eventId: string;
    registrationId: string;
    kind: "CONFIRMATION" | "TICKET_RESEND";
    channel: Channel;
    recipient: string;
    subject: string;
    body: string;
    idempotencyKey: string;
    settings: OperatingSettings;
  },
) {
  const existing = await db.message.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return existing;
  return db.message.create({
    data: {
      ownerId: params.ownerId,
      eventId: params.eventId,
      registrationId: params.registrationId,
      kind: params.kind,
      channel: params.channel,
      recipient: params.recipient,
      subject: params.subject,
      body: params.body,
      billing: "PACKAGE",
      cost: 0,
      operatingCost: params.settings.confirmationOperatingCost[params.channel] ?? 0,
      idempotencyKey: params.idempotencyKey,
    },
  });
}

/** رسالة نظام بدون تكلفة (مثل دعوة عضو فريق الاستقبال) */
export async function enqueueSystemMessage(
  db: Db,
  params: {
    ownerId: string;
    eventId?: string;
    kind: "STAFF_INVITE";
    channel: Channel;
    recipient: string;
    subject: string;
    body: string;
    idempotencyKey: string;
  },
) {
  const existing = await db.message.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return existing;
  return db.message.create({ data: { ...params, billing: "NONE", cost: 0 } });
}

// ───────── معالجة طابور الإرسال ─────────

const STALE_SENDING_MS = 5 * 60 * 1000;

/**
 * يرسل الرسائل المستحقة. آمن للتشغيل المتوازي: كل رسالة "تُحجز" بتحديث شرطي قبل إرسالها.
 * الفشل المؤقت يُعاد بمهلة متزايدة، والفشل النهائي يُسترجع مبلغه للرصيد (حسب الإعدادات).
 */
export async function processOutbox(limit = 100): Promise<{ sent: number; failed: number; retried: number }> {
  const settings = await getSettings();
  const now = new Date();
  await prisma.message.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    data: { status: "QUEUED" },
  });

  const due = await prisma.message.findMany({
    where: { status: "QUEUED", nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let sent = 0,
    failed = 0,
    retried = 0;
  for (const msg of due) {
    const claimed = await prisma.message.updateMany({
      where: { id: msg.id, status: "QUEUED" },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    const attempt = msg.attempts + 1;

    let result: Awaited<ReturnType<ReturnType<typeof getMessageProvider>["send"]>>;
    let providerName = "";
    try {
      const provider = getMessageProvider(msg.channel as Channel);
      providerName = provider.name;
      result = await provider.send({
        id: msg.id,
        channel: msg.channel as Channel,
        to: msg.recipient,
        subject: msg.subject,
        body: msg.body,
        idempotencyKey: msg.idempotencyKey,
        attempt,
      });
    } catch (e) {
      result = { ok: false, retryable: true, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.ok) {
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          provider: providerName,
          providerMessageId: result.providerMessageId,
          lastError: null,
        },
      });
      sent++;
    } else if (result.retryable && attempt < settings.maxSendAttempts) {
      const delay = settings.retryBaseSeconds * 1000 * Math.pow(2, attempt - 1);
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: "QUEUED",
          nextAttemptAt: new Date(Date.now() + delay),
          lastError: result.error,
          provider: providerName,
        },
      });
      retried++;
    } else {
      await markFailed(msg.id, result.error, providerName, settings);
      failed++;
    }
    if (msg.invitationId) await refreshInvitationDelivery(msg.invitationId);
  }
  return { sent, failed, retried };
}

async function markFailed(messageId: string, error: string, providerName: string, settings: OperatingSettings) {
  await withTx(async (tx) => {
    const msg = await tx.message.update({
      where: { id: messageId },
      data: { status: "FAILED", lastError: error, provider: providerName || undefined },
    });
    if (msg.billing === "WALLET" && msg.cost > 0 && settings.refundOnFailure) {
      // حارس: الاسترجاع مرة واحدة فقط لكل رسالة
      const guard = await tx.message.updateMany({ where: { id: msg.id, refunded: false }, data: { refunded: true } });
      if (guard.count === 1) {
        await creditWallet(tx, {
          userId: msg.ownerId,
          amount: msg.cost,
          type: "REFUND",
          description: "استرجاع قيمة رسالة تعذّر إرسالها",
          idempotencyKey: `refund:${msg.id}`,
          messageId: msg.id,
        });
      }
    }
  });
}

/** حالة إرسال الدعوة = تجميع رسائل الدعوة (وليس التذكير) لهذه الدعوة */
export async function refreshInvitationDelivery(invitationId: string, db: Db = prisma) {
  const msgs = await db.message.findMany({
    where: { invitationId, kind: "INVITATION" },
    select: { status: true, sentAt: true },
  });
  let status = "NOT_SENT";
  if (msgs.some((m) => m.status === "SENT")) status = "SENT";
  else if (msgs.some((m) => m.status === "QUEUED" || m.status === "SENDING")) status = "QUEUED";
  else if (msgs.some((m) => m.status === "FAILED")) status = "FAILED";
  const lastSentAt = msgs
    .map((m) => m.sentAt)
    .filter(Boolean)
    .sort((a, b) => b!.getTime() - a!.getTime())[0];
  await db.invitation.update({
    where: { id: invitationId },
    data: { deliveryStatus: status, ...(lastSentAt ? { lastSentAt } : {}) },
  });
}

/** تشغيل الطابور بعد الإجراء دون إفشال الطلب إن حدث خطأ */
export async function kickOutbox() {
  try {
    await processOutbox(200);
  } catch (e) {
    console.error("[outbox]", e);
  }
}
