import { C, col, getDocs } from "./firestore";
import { audit } from "./audit";
import type { Setting } from "./types";

/**
 * إعدادات التشغيل القابلة للمراجعة من لوحة الأدمن.
 * القيم الافتراضية هنا بيانات تجريبية للاختبار وليست أسعارًا معتمدة.
 * المبالغ بالهللة.
 */
export type OperatingSettings = {
  currency: string;
  /** سعر الرسالة الواحدة من رصيد الرسائل حسب القناة */
  messagePrice: { WHATSAPP: number; EMAIL: number };
  /** سعر المكان الإضافي بعد شراء الباقة */
  extraPlacePrice: number;
  /** تكلفة تشغيل تقديرية لرسالة التأكيد مع التذكرة (تُحمّل على الباقة وليس الرصيد) */
  confirmationOperatingCost: { WHATSAPP: number; EMAIL: number };
  /**
   * سياسة الرصيد غير الكافي:
   * BLOCK = لا يُرسل شيء حتى يُشحن الرصيد (الافتراضي)
   * SEND_AFFORDABLE = يُرسل لأكبر عدد يغطيه الرصيد بترتيب القائمة والباقي يبقى غير مُرسل
   */
  insufficientBalancePolicy: "BLOCK" | "SEND_AFFORDABLE";
  /** عدد محاولات الإرسال قبل اعتبار الرسالة فاشلة */
  maxSendAttempts: number;
  /** مهلة إعادة المحاولة الأولى بالثواني (تتضاعف مع كل محاولة) */
  retryBaseSeconds: number;
  /** استرجاع قيمة الرسالة للرصيد عند فشلها نهائيًا */
  refundOnFailure: boolean;
  /** مدة صلاحية فرصة قائمة الانتظار بالساعات */
  waitlistOfferHours: number;
  /** أقل مدة بين إعادة إرسال التذكرة لنفس الضيف (بالدقائق) */
  ticketResendCooldownMinutes: number;
};

export const DEFAULT_SETTINGS: OperatingSettings = {
  currency: "SAR",
  messagePrice: { WHATSAPP: 25, EMAIL: 5 },
  extraPlacePrice: 200,
  confirmationOperatingCost: { WHATSAPP: 15, EMAIL: 1 },
  insufficientBalancePolicy: "BLOCK",
  maxSendAttempts: 3,
  retryBaseSeconds: 30,
  refundOnFailure: true,
  waitlistOfferHours: 48,
  ticketResendCooldownMinutes: 10,
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof OperatingSettings)[];

export async function getSettings(): Promise<OperatingSettings> {
  const rows = (await getDocs<Setting>(col(C.settings))).map((r) => ({ key: r.id, value: r.value }));
  const result = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in result) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        // تجاهل القيم التالفة والإبقاء على الافتراضي
      }
    }
  }
  return result as OperatingSettings;
}

export async function updateSettings(patch: Partial<OperatingSettings>, actorId: string): Promise<void> {
  const before = await getSettings();
  for (const [key, value] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(key as keyof OperatingSettings)) continue;
    await col(C.settings).doc(key).set({ value: JSON.stringify(value), updatedById: actorId, updatedAt: new Date() });
  }
  await audit({
    actorId,
    action: "settings.update",
    entityType: "Setting",
    meta: { before: pick(before, Object.keys(patch)), after: patch },
  });
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
