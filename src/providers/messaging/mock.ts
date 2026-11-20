import type { MessageProvider, OutboundMessage, SendResult } from "./types";

/**
 * مزوّد تجريبي: لا يرسل شيئًا خارج المنصة. الرسائل تظهر في صندوق الرسائل التجريبي (/dev/inbox).
 * قواعد المحاكاة لاختبار الحالات:
 * - واتساب: رقم ينتهي بـ 0000 → فشل نهائي (الرقم غير مسجّل في واتساب)
 * - واتساب: رقم ينتهي بـ 1111 → فشل مؤقت في المحاولة الأولى ثم نجاح
 * - بريد: يحتوي "fail" قبل @ → فشل نهائي (صندوق غير موجود)
 * - بريد: يحتوي "flaky" قبل @ → فشل مؤقت في المحاولة الأولى ثم نجاح
 */
export class MockWhatsAppProvider implements MessageProvider {
  readonly name = "mock-whatsapp";
  readonly channel = "WHATSAPP" as const;
  readonly isMock = true;

  async send(m: OutboundMessage): Promise<SendResult> {
    if (m.to.endsWith("0000")) return { ok: false, retryable: false, error: "الرقم غير مسجّل في واتساب (محاكاة)" };
    if (m.to.endsWith("1111") && m.attempt === 1)
      return { ok: false, retryable: true, error: "انقطاع مؤقت لدى المزوّد (محاكاة)" };
    return { ok: true, providerMessageId: `mock-wa-${m.id}` };
  }
}

export class MockEmailProvider implements MessageProvider {
  readonly name = "mock-email";
  readonly channel = "EMAIL" as const;
  readonly isMock = true;

  async send(m: OutboundMessage): Promise<SendResult> {
    const local = m.to.split("@")[0] ?? "";
    if (local.includes("fail")) return { ok: false, retryable: false, error: "صندوق البريد غير موجود (محاكاة)" };
    if (local.includes("flaky") && m.attempt === 1)
      return { ok: false, retryable: true, error: "رفض مؤقت من خادم البريد (محاكاة)" };
    return { ok: true, providerMessageId: `mock-email-${m.id}` };
  }
}
