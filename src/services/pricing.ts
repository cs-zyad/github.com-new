import type { Event, PricingPlan } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { requiredPlaces } from "./events";

export type PackageQuote =
  | { kind: "NONE"; needed: number; paidPlaces: number }
  | {
      kind: "PACKAGE";
      needed: number;
      paidPlaces: number;
      plan: PricingPlan;
      /** الأماكن التي يضيفها الدفع */
      places: number;
      extraPlaces: number;
      amount: number;
      breakdown: { label: string; amount: number }[];
    }
  | {
      kind: "EXTRA_PLACES";
      needed: number;
      paidPlaces: number;
      places: number;
      unitPrice: number;
      amount: number;
      breakdown: { label: string; amount: number }[];
    };

/**
 * حساب الباقة:
 * - الخاصة: الأماكن = عدد الدعوات + دعوة إضافية لكل دعوة تسمح بمرافق (40 دعوة منها 10 بمرافق = 50 مكانًا)
 * - العامة: الأماكن = الحد الأقصى للحضور
 * أول دفع يختار أصغر باقة تغطي العدد (وإن تجاوز أكبر باقة تُضاف أماكن بسعر المكان الإضافي).
 * بعد الدفع: أي زيادة تُحسب بسعر المكان الإضافي.
 */
export async function quotePackage(event: Event, db: Db = prisma): Promise<PackageQuote> {
  const needed = await requiredPlaces(event, db);
  const settings = await getSettings(db);
  if (needed <= event.paidPlaces && event.paidPlaces > 0) return { kind: "NONE", needed, paidPlaces: event.paidPlaces };
  if (needed === 0) return { kind: "NONE", needed, paidPlaces: event.paidPlaces };

  if (event.paidPlaces === 0) {
    const plans = await db.pricingPlan.findMany({ where: { active: true }, orderBy: { places: "asc" } });
    if (plans.length === 0) throw new Error("لا توجد باقات مفعّلة. أضف باقة من لوحة الأدمن.");
    const fit = plans.find((p) => p.places >= needed);
    const plan = fit ?? plans[plans.length - 1];
    const extraPlaces = fit ? 0 : needed - plan.places;
    const extraAmount = extraPlaces * settings.extraPlacePrice;
    const breakdown = [{ label: `${plan.name} (${plan.places} مكان)`, amount: plan.price }];
    if (extraPlaces) breakdown.push({ label: `${extraPlaces} مكان إضافي`, amount: extraAmount });
    return {
      kind: "PACKAGE",
      needed,
      paidPlaces: 0,
      plan,
      places: plan.places + extraPlaces,
      extraPlaces,
      amount: plan.price + extraAmount,
      breakdown,
    };
  }

  const places = needed - event.paidPlaces;
  return quoteExtraPlaces(event, places, needed);
}

export async function quoteExtraPlaces(
  event: Event,
  places: number,
  needed?: number,
): Promise<Extract<PackageQuote, { kind: "EXTRA_PLACES" }>> {
  const settings = await getSettings();
  const amount = places * settings.extraPlacePrice;
  return {
    kind: "EXTRA_PLACES",
    needed: needed ?? event.paidPlaces + places,
    paidPlaces: event.paidPlaces,
    places,
    unitPrice: settings.extraPlacePrice,
    amount,
    breakdown: [{ label: `${places} مكان إضافي × سعر المكان`, amount }],
  };
}
