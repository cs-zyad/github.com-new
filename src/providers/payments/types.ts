/**
 * واجهة مزوّد الدفع — منطق المنتج لا يعرف اسم المزوّد.
 * تثبيت الدفع يتم فقط عبر إشعار موثّق من المزوّد إلى الخادم (webhook)، وليس من صفحة العودة.
 */
export type CheckoutRequest = {
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
};

export type CheckoutSession = {
  checkoutUrl: string;
  providerRef: string;
};

export type PaymentWebhookEvent = {
  /** معرّف الإشعار لدى المزوّد — يُستخدم لمنع معالجة نفس الإشعار مرتين */
  eventId: string;
  type: "payment.succeeded" | "payment.failed";
  providerRef: string;
  paymentId?: string;
  amount: number;
  currency: string;
};

export interface PaymentProvider {
  readonly name: string;
  readonly isMock: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** يتحقق من توقيع الإشعار ويعيد الحدث، أو يرمي خطأ عند فشل التحقق */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent>;
}
