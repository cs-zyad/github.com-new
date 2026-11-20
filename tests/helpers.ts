import { C, ref, newId, uniqueRef } from "@/lib/firestore";
import { randomToken } from "@/lib/ids";
import { hashPassword } from "@/lib/password";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { creditWallet } from "@/services/wallet";
import { createUser } from "@/services/accounts";
import type { Event, Invitation } from "@/lib/types";

/** مسح كل بيانات المحاكي (قاعدة الاختبار فقط — لا يعمل إلا مع محاكي Firestore) */
export async function resetDb() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("الاختبارات تعمل على محاكي Firestore فقط");
  const project = process.env.FIREBASE_PROJECT_ID || "demo-wafda";
  const res = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error("تعذّر مسح بيانات المحاكي: " + res.status);
}

let counter = 0;
export function uniq() {
  counter++;
  return `${Date.now().toString(36)}${counter}`;
}

let cachedHash: string | null = null;
export async function makeUser(opts: { role?: string; name?: string; email?: string } = {}) {
  cachedHash ??= await hashPassword("Passw0rd!");
  return createUser({ email: opts.email ?? `u${uniq()}@test.local`, name: opts.name ?? "مستخدم", role: opts.role ?? "USER", passwordHash: cachedHash });
}

export async function makeTemplate() {
  const id = newId();
  const now = new Date();
  await ref(C.templates, id).set({
    name: "قالب",
    description: "",
    category: "GENERAL",
    layout: "plum-frame",
    palette: JSON.stringify({ primary: "#28182C", accent: "#DDF480", background: "#FBF7EF", text: "#28182C", muted: "#65586B" }),
    status: "ACTIVE",
    visibility: "PUBLIC",
    ownerId: null,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function makeEvent(
  ownerId: string,
  opts: Partial<{
    mode: "PRIVATE" | "PUBLIC";
    capacity: number;
    paidPlaces: number;
    fullPolicy: "CLOSE" | "WAITLIST";
    status: string;
    templateId: string | null;
  }> = {},
): Promise<Event> {
  const mode = opts.mode ?? "PRIVATE";
  const id = newId();
  const now = new Date();
  const e: Omit<Event, "id"> = {
    ownerId,
    title: "فعالية اختبار",
    hostName: "الجهة",
    description: "",
    startsAt: new Date(Date.now() + 7 * 86400000),
    endsAt: null,
    timezone: "Asia/Riyadh",
    venueName: "القاعة",
    venueAddress: "",
    mapUrl: null,
    mode,
    capacity: opts.capacity ?? 10,
    paidPlaces: opts.paidPlaces ?? 100,
    reservedSeats: 0,
    fullPolicy: opts.fullPolicy ?? "CLOSE",
    status: opts.status ?? "ACTIVE",
    templateId: opts.templateId ?? null,
    publicSlug: mode === "PUBLIC" ? randomToken(9) : null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref(C.events, id).set(e);
  return { id, ...e };
}

let phoneSeq = 100000;
export function nextPhone() {
  phoneSeq++;
  return `05${String(10000000 + phoneSeq).slice(-8)}`;
}

export async function makeInvitation(
  eventId: string,
  opts: Partial<{ name: string; phone: string | null; email: string | null; allowCompanion: boolean; channel: string; deliveryStatus: string }> = {},
): Promise<Invitation> {
  const phone = opts.phone === undefined ? `+9665${String(10000000 + ++phoneSeq).slice(-8)}` : opts.phone;
  const id = newId();
  const now = new Date();
  const inv: Omit<Invitation, "id"> = {
    eventId,
    name: opts.name ?? "مدعو",
    phone,
    email: opts.email ?? null,
    channel: opts.channel ?? (phone ? "WHATSAPP" : "EMAIL"),
    allowCompanion: opts.allowCompanion ?? false,
    deliveryStatus: opts.deliveryStatus ?? "NOT_SENT",
    token: randomToken(),
    lastSentAt: null,
    regStatus: null,
    registrationId: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref(C.invitations, id).set(inv);
  if (inv.phone) await uniqueRef(`inv-phone:${eventId}:${inv.phone}`).set({ ref: id });
  if (inv.email) await uniqueRef(`inv-email:${eventId}:${inv.email}`).set({ ref: id });
  return { id, ...inv };
}

export async function topUp(userId: string, amount: number) {
  await creditWallet({ userId, amount, type: "ADJUSTMENT", description: "test", idempotencyKey: `t:${uniq()}` });
}

export async function seedPlans() {
  const now = new Date();
  for (const p of [
    { name: "صغيرة", places: 50, price: 9900, sortOrder: 1 },
    { name: "متوسطة", places: 100, price: 17900, sortOrder: 2 },
    { name: "كبيرة", places: 250, price: 39900, sortOrder: 3 },
  ]) {
    await ref(C.pricingPlans, newId()).set({ ...p, active: true, isDemo: true, createdAt: now, updatedAt: now });
  }
}

export const settings = DEFAULT_SETTINGS;
