import { prisma, type Db } from "./db";
import { audit } from "./audit";

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

export async function getSettings(db: Db = prisma): Promise<OperatingSettings> {
  const rows = await db.setting.findMany();
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

export async function updateSettings(
  patch: Partial<OperatingSettings>,
  actorId: string,
  db: Db = prisma,
): Promise<void> {
  const before = await getSettings(db);
  for (const [key, value] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(key as keyof OperatingSettings)) continue;
    await db.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value), updatedById: actorId },
      update: { value: JSON.stringify(value), updatedById: actorId },
    });
  }
  await audit(db, {
    actorId,
    action: "settings.update",
    entityType: "Setting",
    meta: { before: pick(before, Object.keys(patch)), after: patch },
  });
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
