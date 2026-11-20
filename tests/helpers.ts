import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/ids";
import { hashPassword } from "@/lib/password";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { creditWallet } from "@/services/wallet";

export async function resetDb() {
  // ترتيب الحذف يراعي العلاقات
  await prisma.checkInLog.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.message.deleteMany();
  await prisma.messageBatch.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.eventStaff.deleteMany();
  await prisma.paymentEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.designRequest.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.event.deleteMany();
  await prisma.template.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.pricingPlan.deleteMany();
  await prisma.setting.deleteMany();
}

let counter = 0;
export function uniq() {
  counter++;
  return `${Date.now().toString(36)}${counter}`;
}

export async function makeUser(opts: { role?: string; name?: string; email?: string } = {}) {
  return prisma.user.create({
    data: {
      email: opts.email ?? `u${uniq()}@test.local`,
      name: opts.name ?? "مستخدم",
      role: opts.role ?? "USER",
      passwordHash: await hashPassword("Passw0rd!"),
    },
  });
}

export async function makeTemplate() {
  return prisma.template.create({
    data: {
      name: "قالب",
      layout: "plum-frame",
      palette: JSON.stringify({ primary: "#28182C", accent: "#DDF480", background: "#FBF7EF", text: "#28182C", muted: "#65586B" }),
    },
  });
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
) {
  const mode = opts.mode ?? "PRIVATE";
  return prisma.event.create({
    data: {
      ownerId,
      title: "فعالية اختبار",
      hostName: "الجهة",
      startsAt: new Date(Date.now() + 7 * 86400000),
      venueName: "القاعة",
      mode,
      capacity: opts.capacity ?? 10,
      paidPlaces: opts.paidPlaces ?? 100,
      fullPolicy: opts.fullPolicy ?? "CLOSE",
      status: opts.status ?? "ACTIVE",
      templateId: opts.templateId ?? null,
      publicSlug: mode === "PUBLIC" ? randomToken(9) : null,
    },
  });
}

let phoneSeq = 100000;
export function nextPhone() {
  phoneSeq++;
  return `05${String(10000000 + phoneSeq).slice(-8)}`;
}

export async function makeInvitation(
  eventId: string,
  opts: Partial<{ name: string; phone: string | null; email: string | null; allowCompanion: boolean; channel: string; deliveryStatus: string }> = {},
) {
  const phone = opts.phone === undefined ? `+9665${String(10000000 + ++phoneSeq).slice(-8)}` : opts.phone;
  return prisma.invitation.create({
    data: {
      eventId,
      name: opts.name ?? "مدعو",
      phone,
      email: opts.email ?? null,
      channel: opts.channel ?? (phone ? "WHATSAPP" : "EMAIL"),
      allowCompanion: opts.allowCompanion ?? false,
      deliveryStatus: opts.deliveryStatus ?? "NOT_SENT",
      token: randomToken(),
    },
  });
}

export async function topUp(userId: string, amount: number) {
  await prisma.$transaction((tx) =>
    creditWallet(tx, { userId, amount, type: "ADJUSTMENT", description: "test", idempotencyKey: `t:${uniq()}` }),
  );
}

export async function seedPlans() {
  await prisma.pricingPlan.createMany({
    data: [
      { name: "صغيرة", places: 50, price: 9900, sortOrder: 1 },
      { name: "متوسطة", places: 100, price: 17900, sortOrder: 2 },
      { name: "كبيرة", places: 250, price: 39900, sortOrder: 3 },
    ],
  });
}

export const settings = DEFAULT_SETTINGS;
