import { env } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";

/** اختيار مزوّد الدفع حسب PAYMENT_PROVIDER. المزوّد الفعلي يُحدّد لاحقًا. */
export function getPaymentProvider(name = env.paymentProvider): PaymentProvider {
  switch (name) {
    case "mock":
      return new MockPaymentProvider();
    default:
      throw new Error(`مزوّد الدفع "${name}" غير مُعرّف. القيم المتاحة حاليًا: mock`);
  }
}

export type { PaymentProvider, PaymentWebhookEvent } from "./types";
