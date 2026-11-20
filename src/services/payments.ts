import { C, col, ref, getDoc, getDocs, getFirst, keyId, newId, runTx, txGet } from "@/lib/firestore";
import { AppError, NotFoundError } from "@/lib/errors";
import { randomToken } from "@/lib/ids";
import { audit, auditTx } from "@/lib/audit";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getPaymentProvider, type PaymentWebhookEvent } from "@/providers/payments";
import { getOwnedEvent } from "./events";
import { quotePackage, quoteExtraPlaces } from "./pricing";
import { readWalletState, writeWalletEntry } from "./wallet";
import type { DesignRequest, Event, Payment, PaymentEvent } from "@/lib/types";

type Purpose = "PACKAGE" | "EXTRA_PLACES" | "WALLET_TOPUP" | "DESIGN";

async function createCheckout(
  data: {
    ownerId: string;
    purpose: Purpose;
    amount: number;
    places?: number;
    eventId?: string;
    designRequestId?: string;
    description: string;
  },
  returnPath: string,
): Promise<{ payment: Payment; checkoutUrl: string }> {
  if (data.amount <= 0) throw new AppError("مبلغ الدفع غير صالح");
  const settings = await getSettings();
  const provider = getPaymentProvider();

  // إعادة استخدام عملية معلّقة مطابقة بدل إنشاء عمليات متعددة لنفس الغرض
  const pendings = (
    await getDocs<Payment>(col(C.payments).where("ownerId", "==", data.ownerId).where("purpose", "==", data.purpose).where("status", "==", "PENDING"))
  )
    .filter((p) => p.eventId === (data.eventId ?? null) && p.designRequestId === (data.designRequestId ?? null))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const pending = pendings[0];
  if (pending && pending.amount === data.amount && pending.places === (data.places ?? 0) && data.purpose !== "WALLET_TOPUP") {
    const session = await provider.createCheckout({
      paymentId: pending.id,
      amount: pending.amount,
      currency: pending.currency,
      description: pending.description,
      returnUrl: `${env.appUrl}${returnPath}`,
    });
    return { payment: pending, checkoutUrl: session.checkoutUrl };
  }
  if (pending && data.purpose !== "WALLET_TOPUP") {
    await ref(C.payments, pending.id).update({ status: "CANCELLED", updatedAt: new Date() });
  }

  const now = new Date();
  const payment: Payment = {
    id: newId(),
    ownerId: data.ownerId,
    purpose: data.purpose,
    amount: data.amount,
    currency: settings.currency,
    places: data.places ?? 0,
    eventId: data.eventId ?? null,
    designRequestId: data.designRequestId ?? null,
    description: data.description,
    status: "PENDING",
    provider: provider.name,
    providerRef: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const session = await provider.createCheckout({
    paymentId: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    description: payment.description,
    returnUrl: `${env.appUrl}${returnPath}`,
  });
  payment.providerRef = session.providerRef;
  const { id, ...rest } = payment;
  await ref(C.payments, id).set(rest);
  await audit({
    actorId: data.ownerId,
    action: "payment.create",
    entityType: "Payment",
    entityId: payment.id,
    meta: { purpose: data.purpose, amount: data.amount, places: data.places ?? 0 },
  });
  return { payment, checkoutUrl: session.checkoutUrl };
}

/** دفع باقة الفعالية (قبل إرسال الدعوات الخاصة أو نشر الرابط العام) */
export async function startPackageCheckout(ownerId: string, eventId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status === "CANCELLED" || event.status === "ENDED") throw new AppError("الفعالية منتهية أو ملغاة");
  if (!event.templateId) throw new AppError("اختر قالب الدعوة واطّلع على المعاينة قبل الدفع");
  if (event.mode === "PRIVATE") {
    const any = await getFirst(col(C.invitations).where("eventId", "==", event.id));
    if (!any) throw new AppError("أضف المدعوين أولًا — الباقة تُحسب حسب عددهم");
  }
  const quote = await quotePackage(event);
  if (quote.kind === "NONE") throw new AppError("الباقة الحالية تغطي العدد المطلوب");
  const returnPath = `/dashboard/events/${event.id}/billing`;
  if (quote.kind === "PACKAGE") {
    return createCheckout(
      { ownerId, purpose: "PACKAGE", amount: quote.amount, places: quote.places, eventId: event.id, description: `باقة ${quote.places} مكان — ${event.title}` },
      returnPath,
    );
  }
  return createCheckout(
    { ownerId, purpose: "EXTRA_PLACES", amount: quote.amount, places: quote.places, eventId: event.id, description: `${quote.places} مكان إضافي — ${event.title}` },
    returnPath,
  );
}

/** شراء أماكن إضافية بعد الدفع */
export async function startExtraPlacesCheckout(ownerId: string, eventId: string, places: number) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.paidPlaces === 0) throw new AppError("ادفع الباقة الأساسية أولًا");
  if (event.status !== "ACTIVE") throw new AppError("الفعالية غير نشطة");
  if (!Number.isInteger(places) || places < 1 || places > 10000) throw new AppError("عدد الأماكن غير صالح");
  const quote = await quoteExtraPlaces(event, places);
  return createCheckout(
    { ownerId, purpose: "EXTRA_PLACES", amount: quote.amount, places, eventId: event.id, description: `${places} مكان إضافي — ${event.title}` },
    `/dashboard/events/${event.id}/billing`,
  );
}

export async function startTopupCheckout(ownerId: string, amount: number) {
  if (!Number.isInteger(amount) || amount < 1000 || amount > 10_000_00) {
    throw new AppError("مبلغ الشحن يجب أن يكون بين 10 و 10,000 ريال");
  }
  return createCheckout({ ownerId, purpose: "WALLET_TOPUP", amount, description: `شحن رصيد الرسائل ${formatMoney(amount)}` }, `/dashboard/wallet`);
}

export async function startDesignCheckout(ownerId: string, designRequestId: string) {
  const req = await getDoc<DesignRequest>(C.designRequests, designRequestId);
  if (!req || req.ownerId !== ownerId) throw new NotFoundError("الطلب غير موجود");
  if (req.status !== "ACCEPTED" || !req.quoteAmount) throw new AppError("اقبل عرض السعر أولًا");
  return createCheckout(
    { ownerId, purpose: "DESIGN", amount: req.quoteAmount, designRequestId: req.id, description: `تصميم خاص: ${req.title}` },
    `/dashboard/designs/${req.id}`,
  );
}

// ───────── إشعارات الدفع ─────────

export type WebhookOutcome = "PROCESSED" | "DUPLICATE" | "IGNORED" | "REJECTED";

/**
 * معالجة إشعار الدفع — المصدر الوحيد لتثبيت الدفع وتطبيق أثره.
 * - التحقق من التوقيع عبر المزوّد.
 * - وثيقة الإشعار معرّفها ثابت من (المزوّد + معرّف الإشعار): الإشعار المكرر لا يُعالج مرتين.
 * - تحويل الحالة إلى PAID وتطبيق الأثر (أماكن/رصيد/تصميم) وتسجيل الإشعار في معاملة واحدة.
 */
export async function handlePaymentWebhook(rawBody: string, headers: Headers, providerName = env.paymentProvider) {
  const provider = getPaymentProvider(providerName);
  let evt: PaymentWebhookEvent;
  try {
    evt = await provider.parseWebhook(rawBody, headers);
  } catch (e) {
    return { outcome: "REJECTED" as WebhookOutcome, message: e instanceof Error ? e.message : "invalid" };
  }

  const target = await getFirst<Payment>(col(C.payments).where("providerRef", "==", evt.providerRef));
  const eventDocId = keyId(`${provider.name}:${evt.eventId}`);

  return runTx(async (tx) => {
    // ── القراءات ──
    const seen = await txGet<PaymentEvent>(tx, ref(C.paymentEvents, eventDocId));
    const payment = target ? await txGet<Payment>(tx, ref(C.payments, target.id)) : null;
    const canApply = !!payment && evt.type === "payment.succeeded" && ["PENDING", "CANCELLED", "FAILED"].includes(payment.status);
    const event = canApply && payment!.eventId ? await txGet<Event>(tx, ref(C.events, payment!.eventId)) : null;
    const wallet = canApply && payment!.purpose === "WALLET_TOPUP" ? await readWalletState(tx, payment!.ownerId, `topup:${payment!.id}`) : null;
    const design = canApply && payment!.designRequestId ? await txGet<DesignRequest>(tx, ref(C.designRequests, payment!.designRequestId)) : null;

    if (seen) return { outcome: "DUPLICATE" as WebhookOutcome, message: "إشعار مكرر — لم يُعالج مرة أخرى" };

    // ── القرار والكتابة ──
    let outcome: WebhookOutcome = "PROCESSED";
    let message = "";
    const now = new Date();
    if (!payment) {
      outcome = "IGNORED";
      message = "عملية دفع غير معروفة";
    } else if (evt.type === "payment.succeeded") {
      if (evt.amount !== payment.amount || evt.currency !== payment.currency) {
        outcome = "REJECTED";
        message = "المبلغ أو العملة لا تطابق عملية الدفع";
      } else if (!canApply) {
        outcome = "IGNORED";
        message = "العملية مثبتة مسبقًا";
      } else {
        tx.update(ref(C.payments, payment.id), { status: "PAID", paidAt: now, updatedAt: now });
        switch (payment.purpose) {
          case "PACKAGE":
          case "EXTRA_PLACES": {
            if (!event) throw new Error("الفعالية غير موجودة للدفع " + payment.id);
            const paidPlaces = event.paidPlaces + payment.places;
            const patch: Record<string, unknown> = { paidPlaces, updatedAt: now };
            if (event.status === "DRAFT") patch.status = "ACTIVE";
            if (event.mode === "PUBLIC") {
              if (!event.publicSlug) patch.publicSlug = randomToken(9);
              if (!event.publishedAt) patch.publishedAt = now;
              // في العامة: شراء أماكن إضافية يرفع السعة بنفس العدد
              if (payment.purpose === "EXTRA_PLACES") patch.capacity = Math.max(event.capacity, paidPlaces);
            }
            tx.update(ref(C.events, event.id), patch);
            break;
          }
          case "WALLET_TOPUP":
            if (wallet && !wallet.entryExists) {
              writeWalletEntry(tx, wallet, {
                userId: payment.ownerId,
                amount: payment.amount,
                type: "TOPUP",
                description: "شحن رصيد الرسائل",
                idempotencyKey: `topup:${payment.id}`,
                paymentId: payment.id,
              });
            }
            break;
          case "DESIGN":
            if (design && design.status === "ACCEPTED") tx.update(ref(C.designRequests, design.id), { status: "PAID", updatedAt: now });
            break;
        }
        auditTx(tx, {
          action: "payment.paid",
          entityType: "Payment",
          entityId: payment.id,
          meta: { purpose: payment.purpose, amount: payment.amount, places: payment.places },
        });
      }
    } else if (evt.type === "payment.failed" && payment.status === "PENDING") {
      tx.update(ref(C.payments, payment.id), { status: "FAILED", updatedAt: now });
    }
    tx.set(ref(C.paymentEvents, eventDocId), {
      provider: provider.name,
      providerEventId: evt.eventId,
      paymentId: payment?.id ?? null,
      type: evt.type,
      payload: rawBody,
      outcome,
      receivedAt: now,
    });
    return { outcome, message };
  });
}
