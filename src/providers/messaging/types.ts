/**
 * واجهة مزوّد الرسائل — منطق المنتج لا يعرف اسم المزوّد.
 * لإضافة مزوّد فعلي (واتساب أو بريد): نفّذ هذه الواجهة وسجّله في index.ts.
 */
export type OutboundMessage = {
  id: string;
  channel: "WHATSAPP" | "EMAIL";
  to: string;
  subject?: string | null;
  body: string;
  /** مفتاح فريد لمنع تكرار الإرسال عند إعادة المحاولة (إن دعمه المزوّد) */
  idempotencyKey: string;
  /** رقم المحاولة الحالية (يبدأ من 1) */
  attempt: number;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; error: string };

export interface MessageProvider {
  readonly name: string;
  readonly channel: "WHATSAPP" | "EMAIL";
  /** هل هو مزوّد تجريبي (لا يرسل فعليًا)؟ */
  readonly isMock: boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}
