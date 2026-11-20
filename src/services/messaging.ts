import { C, col, ref, db, getDoc, getDocs, getMany, keyId, runTx, txGet, type Transaction } from "@/lib/firestore";
import { getSettings, type OperatingSettings } from "@/lib/settings";
import { getMessageProvider } from "@/providers/messaging";
import { readWalletState, writeWalletEntry, InsufficientBalanceError } from "./wallet";
import type { Channel } from "@/lib/constants";
import type { Invitation, Message, MessageBatch } from "@/lib/types";

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

/** قراءة/كتابة إضافية تُنفّذ داخل نفس معاملة الخصم (مثل تحويل حالة فرصة الانتظار) */
export type TxExtra = (tx: Transaction) => Promise<() => void>;

const PART_SIZE = 300;

/**
 * إنشاء دفعة رسائل تُخصم من رصيد الرسائل — معاملة واحدة ذرّية:
 * - مفتاح الدفعة (معرّف وثيقة ثابت) يمنع التكرار عند الضغط المتكرر أو إعادة الطلب.
 * - سياسة الرصيد غير الكافي: BLOCK (لا يُرسل ولا يُخصم شيء) أو SEND_AFFORDABLE.
 * - عناصر الدفعة تُحفظ مع الدفعة، ثم تُنشأ الرسائل منها (materializeBatch) بمعرّفات ثابتة،
 *   فلا ضياع ولا تكرار حتى لو انقطع التنفيذ بعد الخصم (العامل يكمل الدفعات المعلّقة).
 */
export async function enqueueWalletBatch(params: {
  ownerId: string;
  eventId: string;
  kind: "INVITATION" | "REMINDER" | "WAITLIST_OFFER";
  batchKey: string;
  items: OutgoingItem[];
  trigger?: "MANUAL" | "SCHEDULED";
  scheduledJobId?: string;
  settings: OperatingSettings;
  extra?: TxExtra;
}): Promise<EnqueueResult> {
  const batchId = keyId(params.batchKey);
  const result = await runTx(async (tx): Promise<EnqueueResult> => {
    const existing = await txGet<MessageBatch>(tx, ref(C.messageBatches, batchId));
    const wallet = await readWalletState(tx, params.ownerId, `batch:${batchId}`);
    const extraWrite = params.extra ? await params.extra(tx) : null;
    if (existing) {
      return { batchId, duplicate: true, queued: existing.messageCount, skipped: 0, totalCost: existing.totalCost };
    }

    let items = params.items;
    let total = items.reduce((s, it) => s + messageCost(params.settings, it.channel), 0);
    if (total > wallet.balance) {
      if (params.settings.insufficientBalancePolicy !== "SEND_AFFORDABLE") throw new InsufficientBalanceError(total, wallet.balance);
      let left = wallet.balance;
      const affordable: OutgoingItem[] = [];
      for (const it of items) {
        const c = messageCost(params.settings, it.channel);
        if (c <= left) {
          affordable.push(it);
          left -= c;
        }
      }
      if (!affordable.length) throw new InsufficientBalanceError(total, wallet.balance);
      items = affordable;
      total = items.reduce((s, it) => s + messageCost(params.settings, it.channel), 0);
    }

    const now = new Date();
    const parts = Math.ceil(items.length / PART_SIZE);
    tx.set(ref(C.messageBatches, batchId), {
      ownerId: params.ownerId,
      eventId: params.eventId,
      kind: params.kind,
      idempotencyKey: params.batchKey,
      recipientCount: new Set(items.map((i) => i.invitationId ?? i.registrationId ?? i.recipient)).size,
      messageCount: items.length,
      totalCost: total,
      trigger: params.trigger ?? "MANUAL",
      scheduledJobId: params.scheduledJobId ?? null,
      status: "PENDING_WRITE",
      parts,
      createdAt: now,
    });
    for (let p = 0; p < parts; p++) {
      tx.set(ref(C.messageBatches, batchId).collection("parts").doc(String(p)), {
        items: items.slice(p * PART_SIZE, (p + 1) * PART_SIZE).map((it) => ({
          ...it,
          cost: messageCost(params.settings, it.channel),
        })),
      });
    }
    if (total > 0) {
      writeWalletEntry(tx, wallet, {
        userId: params.ownerId,
        amount: -total,
        type: "DEBIT",
        description: `${kindText(params.kind)}: ${items.length} رسالة`,
        idempotencyKey: `batch:${batchId}`,
        batchId,
      });
    }
    extraWrite?.();
    return { batchId, duplicate: false, queued: items.length, skipped: params.items.length - items.length, totalCost: total };
  });
  await materializeBatch(batchId);
  return result;
}

function kindText(kind: string) {
  return kind === "INVITATION" ? "إرسال دعوات" : kind === "REMINDER" ? "تذكير" : "فرصة قائمة الانتظار";
}

/** إنشاء رسائل الدفعة من عناصرها المحفوظة (آمن للتكرار: معرّف كل رسالة ثابت) */
export async function materializeBatch(batchId: string) {
  const batch = await getDoc<MessageBatch & { status: string; parts: number }>(C.messageBatches, batchId);
  if (!batch || batch.status === "READY") return;
  const partSnaps = await ref(C.messageBatches, batchId).collection("parts").get();
  type StoredItem = OutgoingItem & { cost: number };
  const items: StoredItem[] = partSnaps.docs.flatMap((d) => (d.data().items ?? []) as StoredItem[]);
  const now = new Date();
  const writer = db().bulkWriter();
  writer.onWriteError((err) => err.code !== 6 && err.failedAttempts < 5);
  const ops: Promise<unknown>[] = [];
  for (const it of items) {
    const idem = `${batchId}:${it.key}`;
    ops.push(
      writer
        .create(ref(C.messages, keyId(idem)), {
          ownerId: batch.ownerId,
          eventId: batch.eventId,
          batchId,
          invitationId: it.invitationId ?? null,
          registrationId: it.registrationId ?? null,
          kind: batch.kind,
          channel: it.channel,
          recipient: it.recipient,
          subject: it.subject ?? null,
          body: it.body,
          status: "QUEUED",
          attempts: 0,
          nextAttemptAt: now,
          lastError: null,
          provider: null,
          providerMessageId: null,
          billing: "WALLET",
          cost: it.cost,
          operatingCost: 0,
          refunded: false,
          idempotencyKey: idem,
          sentAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .catch((e: { code?: number }) => {
          if (e.code !== 6) throw e; // ALREADY_EXISTS = أُنشئت مسبقًا
        }),
    );
  }
  if (batch.kind === "INVITATION") {
    const invs = await getMany<Invitation>(C.invitations, items.map((i) => i.invitationId));
    for (const inv of invs) {
      if (inv.deliveryStatus === "NOT_SENT" || inv.deliveryStatus === "FAILED") {
        ops.push(writer.update(ref(C.invitations, inv.id), { deliveryStatus: "QUEUED", updatedAt: now }));
      }
    }
  }
  await writer.close();
  await Promise.all(ops);
  await ref(C.messageBatches, batchId).update({ status: "READY" });
}

/** إكمال الدفعات التي انقطع إنشاء رسائلها (يستدعيه العامل) */
export async function repairPendingBatches() {
  const pending = await getDocs<MessageBatch & { status: string }>(col(C.messageBatches).where("status", "==", "PENDING_WRITE").limit(20));
  for (const b of pending) {
    if (Date.now() - b.createdAt.getTime() > 30_000) await materializeBatch(b.id);
  }
  return pending.length;
}

function messageDoc(params: {
  ownerId: string;
  eventId: string | null;
  registrationId?: string | null;
  kind: string;
  channel: Channel;
  recipient: string;
  subject: string;
  body: string;
  billing: "PACKAGE" | "NONE";
  operatingCost: number;
  idempotencyKey: string;
}) {
  const now = new Date();
  return {
    ownerId: params.ownerId,
    eventId: params.eventId,
    batchId: null,
    invitationId: null,
    registrationId: params.registrationId ?? null,
    kind: params.kind,
    channel: params.channel,
    recipient: params.recipient,
    subject: params.subject,
    body: params.body,
    status: "QUEUED",
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    provider: null,
    providerMessageId: null,
    billing: params.billing,
    cost: 0,
    operatingCost: params.operatingCost,
    refunded: false,
    idempotencyKey: params.idempotencyKey,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * رسالة مشمولة في الباقة (تأكيد الحضور مع التذكرة) — لا تُخصم من رصيد الرسائل،
 * وتُسجّل لها تكلفة تشغيل تقديرية معزولة محاسبيًا. تُكتب داخل معاملة التأكيد.
 */
export function writePackageMessage(
  tx: Transaction,
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
  tx.set(
    ref(C.messages, keyId(params.idempotencyKey)),
    messageDoc({ ...params, billing: "PACKAGE", operatingCost: params.settings.confirmationOperatingCost[params.channel] ?? 0 }),
  );
}

/** رسالة نظام بدون تكلفة (مثل دعوة عضو فريق الاستقبال) */
export function writeSystemMessage(
  tx: Transaction,
  params: { ownerId: string; eventId?: string; kind: "STAFF_INVITE"; channel: Channel; recipient: string; subject: string; body: string; idempotencyKey: string },
) {
  tx.set(ref(C.messages, keyId(params.idempotencyKey)), messageDoc({ ...params, eventId: params.eventId ?? null, billing: "NONE", operatingCost: 0 }));
}

// ───────── معالجة طابور الإرسال ─────────

const STALE_SENDING_MS = 5 * 60 * 1000;

/**
 * يرسل الرسائل المستحقة. آمن للتشغيل المتوازي: كل رسالة "تُحجز" بمعاملة قبل إرسالها.
 * الفشل المؤقت يُعاد بمهلة متزايدة، والفشل النهائي يُسترجع مبلغه للرصيد (حسب الإعدادات).
 */
export async function processOutbox(limit = 100): Promise<{ sent: number; failed: number; retried: number }> {
  const settings = await getSettings();
  const now = Date.now();

  const sending = await getDocs<Message>(col(C.messages).where("status", "==", "SENDING").limit(50));
  for (const m of sending) {
    if (now - m.updatedAt.getTime() > STALE_SENDING_MS) {
      await ref(C.messages, m.id).update({ status: "QUEUED", updatedAt: new Date() });
    }
  }

  const queued = await getDocs<Message>(col(C.messages).where("status", "==", "QUEUED").limit(limit * 3));
  const due = queued
    .filter((m) => m.nextAttemptAt.getTime() <= now)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, limit);

  let sent = 0,
    failed = 0,
    retried = 0;
  const touchedInvitations = new Set<string>();
  for (const msg of due) {
    const claimed = await runTx(async (tx) => {
      const cur = await txGet<Message>(tx, ref(C.messages, msg.id));
      if (!cur || cur.status !== "QUEUED") return null;
      tx.update(ref(C.messages, msg.id), { status: "SENDING", attempts: cur.attempts + 1, updatedAt: new Date() });
      return cur.attempts + 1;
    });
    if (claimed === null) continue;
    const attempt = claimed;

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
      await ref(C.messages, msg.id).update({
        status: "SENT",
        sentAt: new Date(),
        provider: providerName,
        providerMessageId: result.providerMessageId,
        lastError: null,
        updatedAt: new Date(),
      });
      sent++;
    } else if (result.retryable && attempt < settings.maxSendAttempts) {
      const delay = settings.retryBaseSeconds * 1000 * Math.pow(2, attempt - 1);
      await ref(C.messages, msg.id).update({
        status: "QUEUED",
        nextAttemptAt: new Date(Date.now() + delay),
        lastError: result.error,
        provider: providerName,
        updatedAt: new Date(),
      });
      retried++;
    } else {
      await markFailed(msg.id, result.error, providerName, settings);
      failed++;
    }
    if (msg.invitationId) touchedInvitations.add(msg.invitationId);
  }
  for (const id of touchedInvitations) await refreshInvitationDelivery(id);
  return { sent, failed, retried };
}

async function markFailed(messageId: string, error: string, providerName: string, settings: OperatingSettings) {
  // تحديث الحالة والاسترجاع في معاملة واحدة؛ قيد الاسترجاع بمفتاح ثابت لكل رسالة فلا يتكرر
  await runTx(async (tx) => {
    const msg = await txGet<Message>(tx, ref(C.messages, messageId));
    if (!msg) return;
    const shouldRefund = msg.billing === "WALLET" && msg.cost > 0 && settings.refundOnFailure && !msg.refunded;
    const refundKey = `refund:${msg.id}`;
    const wallet = shouldRefund ? await readWalletState(tx, msg.ownerId, refundKey) : null;
    tx.update(ref(C.messages, messageId), {
      status: "FAILED",
      lastError: error,
      provider: providerName || msg.provider,
      refunded: shouldRefund ? true : msg.refunded,
      updatedAt: new Date(),
    });
    if (shouldRefund && wallet && !wallet.entryExists) {
      writeWalletEntry(tx, wallet, {
        userId: msg.ownerId,
        amount: msg.cost,
        type: "REFUND",
        description: "استرجاع قيمة رسالة تعذّر إرسالها",
        idempotencyKey: refundKey,
        messageId: msg.id,
      });
    }
  });
}

/** حالة إرسال الدعوة = تجميع رسائل الدعوة (وليس التذكير) لهذه الدعوة */
export async function refreshInvitationDelivery(invitationId: string) {
  const msgs = await getDocs<Message>(col(C.messages).where("invitationId", "==", invitationId).where("kind", "==", "INVITATION"));
  let status = "NOT_SENT";
  if (msgs.some((m) => m.status === "SENT")) status = "SENT";
  else if (msgs.some((m) => m.status === "QUEUED" || m.status === "SENDING")) status = "QUEUED";
  else if (msgs.some((m) => m.status === "FAILED")) status = "FAILED";
  const lastSentAt = msgs
    .map((m) => m.sentAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const inv = await getDoc<Invitation>(C.invitations, invitationId);
  if (!inv) return;
  await ref(C.invitations, invitationId).update({ deliveryStatus: status, ...(lastSentAt ? { lastSentAt } : {}), updatedAt: new Date() });
}

/** تشغيل الطابور بعد الإجراء دون إفشال الطلب إن حدث خطأ */
export async function kickOutbox() {
  try {
    await processOutbox(200);
  } catch (e) {
    console.error("[outbox]", e);
  }
}
