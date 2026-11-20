import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/ids";
import type { CheckoutRequest, CheckoutSession, PaymentProvider, PaymentWebhookEvent } from "./types";

export const MOCK_SIGNATURE_HEADER = "x-wafda-signature";

export function signMockPayload(rawBody: string): string {
  return createHmac("sha256", env.paymentWebhookSecret).update(rawBody).digest("hex");
}

/**
 * مزوّد دفع تجريبي: صفحة دفع محلية (/dev/checkout/[id]) ترسل إشعارًا موقّعًا بنفس مسار المزوّد الفعلي.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  readonly isMock = true;

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    return {
      checkoutUrl: `/dev/checkout/${req.paymentId}`,
      providerRef: `mock_${req.paymentId}`,
    };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent> {
    const signature = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
    const expected = signMockPayload(rawBody);
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("توقيع إشعار الدفع غير صحيح");
    const data = JSON.parse(rawBody) as PaymentWebhookEvent;
    if (!data.eventId || !data.providerRef || !data.type) throw new Error("إشعار دفع ناقص");
    return data;
  }
}

/** بناء إشعار تجريبي موقّع (يُستخدم من صفحة الدفع التجريبية والاختبارات) */
export function buildMockWebhook(params: {
  providerRef: string;
  paymentId: string;
  amount: number;
  currency: string;
  type: "payment.succeeded" | "payment.failed";
  eventId?: string;
}) {
  const payload: PaymentWebhookEvent = {
    eventId: params.eventId ?? `evt_${randomToken(10)}`,
    type: params.type,
    providerRef: params.providerRef,
    paymentId: params.paymentId,
    amount: params.amount,
    currency: params.currency,
  };
  const rawBody = JSON.stringify(payload);
  const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: signMockPayload(rawBody), "content-type": "application/json" });
  return { rawBody, headers, payload };
}
