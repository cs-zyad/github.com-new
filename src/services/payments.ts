import type { Payment } from "@prisma/client";
import { prisma, withTx, isUniqueViolation, type Tx } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { randomToken } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getPaymentProvider, type PaymentWebhookEvent } from "@/providers/payments";
import { getOwnedEvent } from "./events";
import { quotePackage, quoteExtraPlaces } from "./pricing";
import { creditWallet } from "./wallet";

async function createCheckout(
  data: {
    ownerId: string;
    purpose: "PACKAGE" | "EXTRA_PLACES" | "WALLET_TOPUP" | "DESIGN";
    amount: number;
    places?: number;
    eventId?: string;
    designRequestId?: string;
    description: string;
  },
  returnPath: string,
) {
  if (data.amount <= 0) throw new AppError("مبلغ الدفع غير صالح");
  const settings = await getSettings();
  const provider = getPaymentProvider();

  // إعادة استخدام عملية معلّقة مطابقة بدل إنشاء عمليات متعددة لنفس الغرض
  const pending = await prisma.payment.findFirst({
    where: {
      ownerId: data.ownerId,
      purpose: data.purpose,
      eventId: data.eventId ?? null,
      designRequestId: data.designRequestId ?? null,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });
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
    await prisma.payment.update({ where: { id: pending.id }, data: { status: "CANCELLED" } });
  }

  const payment = await prisma.payment.create({
    data: {
      ownerId: data.ownerId,
      purpose: data.purpose,
      amount: data.amount,
      currency: settings.currency,
      places: data.places ?? 0,
      eventId: data.eventId,
      designRequestId: data.designRequestId,
      description: data.description,
      provider: provider.name,
    },
  });
  const session = await provider.createCheckout({
    paymentId: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    description: payment.description,
    returnUrl: `${env.appUrl}${returnPath}`,
  });
  const updated = await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: session.providerRef } });
  await audit(prisma, {
    actorId: data.ownerId,
    action: "payment.create",
    entityType: "Payment",
    entityId: payment.id,
    meta: { purpose: data.purpose, amount: data.amount, places: data.places ?? 0 },
  });
  return { payment: updated, checkoutUrl: session.checkoutUrl };
}

/** دفع باقة الفعالية (قبل إرسال الدعوات الخاصة أو نشر الرابط العام) */
export async function startPackageCheckout(ownerId: string, eventId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status === "CANCELLED" || event.status === "ENDED") throw new AppError("الفعالية منتهية أو ملغاة");
  if (!event.templateId) throw new AppError("اختر قالب الدعوة واطّلع على المعاينة قبل الدفع");
  if (event.mode === "PRIVATE") {
    const count = await prisma.invitation.count({ where: { eventId: event.id } });
    if (count === 0) throw new AppError("أضف المدعوين أولًا — الباقة تُحسب حسب عددهم");
  }
  const quote = await quotePackage(event);
  if (quote.kind === "NONE") throw new AppError("الباقة الحالية تغطي العدد المطلوب");
  if (quote.kind === "PACKAGE") {
    return createCheckout(
      {
        ownerId,
        purpose: "PACKAGE",
        amount: quote.amount,
        places: quote.places,
        eventId: event.id,
        description: `باقة ${quote.places} مكان — ${event.title}`,
      },
      `/dashboard/events/${event.id}/billing`,
    );
  }
  return createCheckout(
    {
      ownerId,
      purpose: "EXTRA_PLACES",
      amount: quote.amount,
      places: quote.places,
      eventId: event.id,
      description: `${quote.places} مكان إضافي — ${event.title}`,
    },
    `/dashboard/events/${event.id}/billing`,
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
    {
      ownerId,
      purpose: "EXTRA_PLACES",
      amount: quote.amount,
      places,
      eventId: event.id,
      description: `${places} مكان إضافي — ${event.title}`,
    },
    `/dashboard/events/${event.id}/billing`,
  );
}

export async function startTopupCheckout(ownerId: string, amount: number) {
  if (!Number.isInteger(amount) || amount < 1000 || amount > 10_000_00) {
    throw new AppError("مبلغ الشحن يجب أن يكون بين 10 و 10,000 ريال");
  }
  return createCheckout(
    { ownerId, purpose: "WALLET_TOPUP", amount, description: `شحن رصيد الرسائل ${formatMoney(amount)}` },
    `/dashboard/wallet`,
  );
}

export async function startDesignCheckout(ownerId: string, designRequestId: string) {
  const req = await prisma.designRequest.findFirst({ where: { id: designRequestId, ownerId } });
  if (!req) throw new NotFoundError("الطلب غير موجود");
  if (req.status !== "ACCEPTED" || !req.quoteAmount) throw new AppError("اقبل عرض السعر أولًا");
  return createCheckout(
    {
      ownerId,
      purpose: "DESIGN",
      amount: req.quoteAmount,
      designRequestId: req.id,
      description: `تصميم خاص: ${req.title}`,
    },
    `/dashboard/designs/${req.id}`,
  );
}

// ───────── إشعارات الدفع ─────────

export type WebhookOutcome = "PROCESSED" | "DUPLICATE" | "IGNORED" | "REJECTED";

/**
 * معالجة إشعار الدفع — المصدر الوحيد لتثبيت الدفع وتطبيق أثره.
 * - التحقق من التوقيع عبر المزوّد.
 * - تسجيل الإشعار بمفتاح فريد (provider + eventId): الإشعار المكرر لا يُعالج مرتين.
 * - تحويل الحالة PENDING → PAID بتحديث شرطي: الأثر (مقاعد/رصيد) يُطبق مرة واحدة فقط.
 * - كل ذلك في معاملة واحدة: إن فشل تطبيق الأثر لا يُسجّل الإشعار، فيعيد المزوّد المحاولة.
 */
export async function handlePaymentWebhook(rawBody: string, headers: Headers, providerName = env.paymentProvider) {
  const provider = getPaymentProvider(providerName);
  let evt: PaymentWebhookEvent;
  try {
    evt = await provider.parseWebhook(rawBody, headers);
  } catch (e) {
    return { outcome: "REJECTED" as WebhookOutcome, message: e instanceof Error ? e.message : "invalid" };
  }

  try {
    return await withTx(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { providerRef: evt.providerRef } });
      let outcome: WebhookOutcome = "PROCESSED";
      let message = "";
      if (!payment) {
        outcome = "IGNORED";
        message = "عملية دفع غير معروفة";
      } else if (evt.type === "payment.succeeded") {
        if (evt.amount !== payment.amount || evt.currency !== payment.currency) {
          outcome = "REJECTED";
          message = "المبلغ أو العملة لا تطابق عملية الدفع";
        } else {
          const applied = await markPaidAndFulfill(tx, payment);
          if (!applied) {
            outcome = "IGNORED";
            message = "العملية مثبتة مسبقًا";
          }
        }
      } else if (evt.type === "payment.failed") {
        await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
      }
      await tx.paymentEvent.create({
        data: {
          provider: provider.name,
          providerEventId: evt.eventId,
          paymentId: payment?.id,
          type: evt.type,
          payload: rawBody,
          outcome,
        },
      });
      return { outcome, message };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { outcome: "DUPLICATE" as WebhookOutcome, message: "إشعار مكرر — لم يُعالج مرة أخرى" };
    throw e;
  }
}

async function markPaidAndFulfill(tx: Tx, payment: Payment): Promise<boolean> {
  // PENDING أو CANCELLED (المستخدم فتح صفحة دفع أحدث لكنه دفع القديمة — المال وصل فنثبّته)
  const res = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: ["PENDING", "CANCELLED", "FAILED"] } },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (res.count !== 1) return false;

  switch (payment.purpose) {
    case "PACKAGE":
    case "EXTRA_PLACES": {
      const event = await tx.event.findUniqueOrThrow({ where: { id: payment.eventId! } });
      const data: Record<string, unknown> = { paidPlaces: { increment: payment.places } };
      if (event.status === "DRAFT") data.status = "ACTIVE";
      if (event.mode === "PUBLIC") {
        if (!event.publicSlug) data.publicSlug = randomToken(9);
        if (!event.publishedAt) data.publishedAt = new Date();
        // في العامة: شراء أماكن إضافية يرفع السعة بنفس العدد
        if (payment.purpose === "EXTRA_PLACES") {
          data.capacity = Math.max(event.capacity, event.paidPlaces + payment.places);
        }
      }
      await tx.event.update({ where: { id: event.id }, data });
      break;
    }
    case "WALLET_TOPUP":
      await creditWallet(tx, {
        userId: payment.ownerId,
        amount: payment.amount,
        type: "TOPUP",
        description: "شحن رصيد الرسائل",
        idempotencyKey: `topup:${payment.id}`,
        paymentId: payment.id,
      });
      break;
    case "DESIGN":
      await tx.designRequest.updateMany({
        where: { id: payment.designRequestId!, status: "ACCEPTED" },
        data: { status: "PAID" },
      });
      break;
  }
  await audit(tx, {
    action: "payment.paid",
    entityType: "Payment",
    entityId: payment.id,
    meta: { purpose: payment.purpose, amount: payment.amount, places: payment.places },
  });
  return true;
}
