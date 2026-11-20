import { env } from "@/lib/env";
import type { MessageProvider } from "./types";
import { MockEmailProvider, MockWhatsAppProvider } from "./mock";

/**
 * اختيار المزوّد حسب متغيرات البيئة.
 * المزوّدات الفعلية لم تُحدّد بعد — عند اعتمادها أضف الصنف هنا (مثال: "meta-cloud" لواتساب، "smtp" للبريد).
 */
export function getMessageProvider(channel: "WHATSAPP" | "EMAIL"): MessageProvider {
  const name = channel === "WHATSAPP" ? env.whatsappProvider : env.emailProvider;
  switch (name) {
    case "mock":
      return channel === "WHATSAPP" ? new MockWhatsAppProvider() : new MockEmailProvider();
    default:
      throw new Error(`مزوّد الرسائل "${name}" غير مُعرّف. القيم المتاحة حاليًا: mock`);
  }
}

export function providerStatus() {
  return {
    whatsapp: env.whatsappProvider,
    email: env.emailProvider,
    whatsappIsMock: env.whatsappProvider === "mock",
    emailIsMock: env.emailProvider === "mock",
  };
}

export type { MessageProvider, OutboundMessage, SendResult } from "./types";
