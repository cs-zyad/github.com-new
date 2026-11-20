import { z } from "zod";
import type { Event, Registration } from "@prisma/client";
import { prisma, withTx, isUniqueViolation, type Tx } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { randomToken } from "@/lib/ids";
import { getSettings, type OperatingSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { availableSeats } from "./events";
import { issueTickets, cancelTickets } from "./tickets";
import { composeConfirmation, composeTicketResend } from "./compose";
import { enqueuePackageMessage, kickOutbox } from "./messaging";

// ───────── السعة: الحجز والإفراج الذرّي ─────────

/**
 * حجز مقاعد بتحديث شرطي واحد — آمن للتزامن في SQLite وPostgreSQL:
 * لا ينجح إلا إذا بقي الحجز ضمن الحد (والأماكن المدفوعة في الفعالية العامة).
 */
export async function reserveSeats(tx: Tx, eventId: string, n: number): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE "Event"
    SET "reservedSeats" = "reservedSeats" + ${n}
    WHERE "id" = ${eventId}
      AND "status" = 'ACTIVE'
      AND "reservedSeats" + ${n} <= "capacity"
      AND ("mode" <> 'PUBLIC' OR "reservedSeats" + ${n} <= "paidPlaces")`;
  return count === 1;
}

export async function releaseSeats(tx: Tx, eventId: string, n: number) {
  if (n <= 0) return;
  await tx.event.updateMany({
    where: { id: eventId, reservedSeats: { gte: n } },
    data: { reservedSeats: { decrement: n } },
  });
}

// ───────── التحقق من المدخلات ─────────

export const contactSchema = z
  .object({
    name: z.string().trim().min(2, "اكتب الاسم").max(80, "الاسم طويل"),
    contactMethod: z.enum(["WHATSAPP", "EMAIL"], { message: "اختر وسيلة التواصل" }),
    phone: z.string().optional().default(""),
    email: z.string().optional().default(""),
  })
  .transform((d, ctx) => {
    if (d.contactMethod === "WHATSAPP") {
      const phone = normalizePhone(d.phone);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: "رقم الجوال غير صحيح. مثال: 05xxxxxxxx" });
        return z.NEVER;
      }
      return { name: d.name, contactMethod: d.contactMethod, phone, email: null as string | null };
    }
    const email = normalizeEmail(d.email);
    if (!email) {
      ctx.addIssue({ code: "custom", message: "البريد الإلكتروني غير صحيح" });
      return z.NEVER;
    }
    return { name: d.name, contactMethod: d.contactMethod, phone: null as string | null, email };
  });

export type ContactInput = z.input<typeof contactSchema>;

function parseContact(input: ContactInput) {
  const r = contactSchema.safeParse(input);
  if (!r.success) throw new AppError(r.error.issues[0]?.message ?? "بيانات غير صالحة");
  return r.data;
}

function dedupeKeyFor(c: { contactMethod: string; phone: string | null; email: string | null }) {
  return c.contactMethod === "WHATSAPP" ? `wa:${c.phone}` : `em:${c.email}`;
}

// ───────── حالة الفعالية ─────────

export type ClosedReason = "NOT_ACTIVE" | "CANCELLED" | "ENDED";

export function rsvpClosedReason(event: Event): ClosedReason | null {
  if (event.status === "CANCELLED") return "CANCELLED";
  if (event.status === "ENDED") return "ENDED";
  if (event.status !== "ACTIVE") return "NOT_ACTIVE";
  const end = event.endsAt ?? new Date(event.startsAt.getTime() + 6 * 3600 * 1000);
  if (Date.now() > end.getTime()) return "ENDED";
  return null;
}

// ───────── نتائج التأكيد ─────────

export type RsvpOutcome =
  | { status: "CONFIRMED"; accessToken: string; already: boolean }
  | { status: "WAITLISTED"; accessToken: string; already: boolean }
  | { status: "FULL" }
  | { status: "ONLY_ONE_LEFT" }
  | { status: "OFFER_UNAVAILABLE"; accessToken: string }
  | { status: "OFFER_EXPIRED"; accessToken: string }
  | { status: "ALREADY_REGISTERED"; resent: boolean; waitlisted: boolean }
  | { status: "CLOSED"; reason: ClosedReason };

/** تأكيد الحجز بعد نجاح حجز المقاعد: التذاكر + رسالة التأكيد (ضمن الباقة) */
async function finalizeConfirmed(
  tx: Tx,
  event: Event,
  reg: Registration,
  settings: OperatingSettings,
) {
  const tickets = await issueTickets(tx, {
    eventId: event.id,
    registrationId: reg.id,
    holderName: reg.name,
    withCompanion: reg.withCompanion,
  });
  const msg = composeConfirmation(event, reg, tickets);
  const recipient = reg.contactMethod === "WHATSAPP" ? reg.phone : reg.email;
  if (recipient) {
    await enqueuePackageMessage(tx, {
      ownerId: event.ownerId,
      eventId: event.id,
      registrationId: reg.id,
      kind: "CONFIRMATION",
      channel: reg.contactMethod as "WHATSAPP" | "EMAIL",
      recipient,
      subject: msg.subject,
      body: msg.body,
      idempotencyKey: `confirm:${reg.id}:${reg.confirmedAt?.getTime() ?? 0}`,
      settings,
    });
  }
  return tickets;
}

/** تشغيل المعاملة مع إعادة محاولة واحدة عند تعارض القيود الفريدة (تأكيد متزامن لنفس الشخص) */
async function runRsvp<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withTx(fn);
  } catch (e) {
    if (isUniqueViolation(e)) return withTx(fn);
    throw e;
  }
}

// ───────── الدعوة الخاصة ─────────

export async function getInvitationByToken(token: string) {
  const inv = await prisma.invitation.findUnique({
    where: { token },
    include: { event: { include: { template: true } }, registration: { include: { tickets: true } } },
  });
  if (!inv) throw new NotFoundError("الدعوة غير موجودة أو الرابط غير صحيح");
  return inv;
}

export async function confirmInvitation(params: {
  token: string;
  contact: ContactInput;
  withCompanion: boolean;
}): Promise<RsvpOutcome> {
  const contact = parseContact(params.contact);
  const settings = await getSettings();
  const outcome = await runRsvp(async (tx): Promise<RsvpOutcome> => {
    const inv = await tx.invitation.findUnique({ where: { token: params.token }, include: { event: true, registration: true } });
    if (!inv || inv.event.mode !== "PRIVATE") throw new NotFoundError("الدعوة غير موجودة");
    const event = inv.event;
    const closed = rsvpClosedReason(event);
    if (closed) return { status: "CLOSED", reason: closed };

    const want = params.withCompanion && inv.allowCompanion ? 2 : 1;
    const reg = inv.registration;

    if (reg?.status === "CONFIRMED") return { status: "CONFIRMED", accessToken: reg.accessToken, already: true };
    if (reg?.status === "WAITLISTED") return { status: "WAITLISTED", accessToken: reg.accessToken, already: true };
    if (reg?.status === "OFFERED") {
      return claimOfferInTx(tx, event, reg, { withCompanion: want === 2, contact, settings });
    }

    const ok = await reserveSeats(tx, event.id, want);
    if (!ok) {
      const fresh = await tx.event.findUniqueOrThrow({ where: { id: event.id } });
      if (want === 2 && availableSeats(fresh) === 1) return { status: "ONLY_ONE_LEFT" };
      if (fresh.fullPolicy === "WAITLIST") {
        const data = {
          name: contact.name,
          contactMethod: contact.contactMethod,
          phone: contact.phone,
          email: contact.email,
          withCompanion: want === 2,
          seats: 0,
          seatsRequested: want,
          status: "WAITLISTED",
        };
        const w = reg
          ? await guardedUpdate(tx, reg, data)
          : await tx.registration.create({
              data: { ...data, eventId: event.id, invitationId: inv.id, source: "INVITATION", accessToken: randomToken() },
            });
        return { status: "WAITLISTED", accessToken: w.accessToken, already: false };
      }
      return { status: "FULL" };
    }

    const now = new Date();
    const data = {
      name: contact.name,
      contactMethod: contact.contactMethod,
      phone: contact.phone,
      email: contact.email,
      withCompanion: want === 2,
      seats: want,
      seatsRequested: want,
      status: "CONFIRMED",
      confirmedAt: now,
      cancelledAt: null,
      offeredAt: null,
      offerExpiresAt: null,
    };
    const confirmed = reg
      ? await guardedUpdate(tx, reg, data)
      : await tx.registration.create({
          data: { ...data, eventId: event.id, invitationId: inv.id, source: "INVITATION", accessToken: randomToken() },
        });
    await finalizeConfirmed(tx, event, confirmed, settings);
    return { status: "CONFIRMED", accessToken: confirmed.accessToken, already: false };
  });
  await kickOutbox();
  return outcome;
}

/** تحديث مشروط بالحالة السابقة — يمنع تعارض تعديلين متزامنين على نفس التسجيل */
async function guardedUpdate(tx: Tx, reg: Registration, data: Partial<Registration>) {
  const res = await tx.registration.updateMany({ where: { id: reg.id, status: reg.status, updatedAt: reg.updatedAt }, data });
  if (res.count !== 1) throw new AppError("تغيّرت حالة التسجيل للتو. حدّث الصفحة وحاول مرة أخرى.", "CONFLICT", 409);
  return tx.registration.findUniqueOrThrow({ where: { id: reg.id } });
}

export async function declineInvitation(token: string): Promise<{ accessToken: string }> {
  const result = await runRsvp(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { token }, include: { event: true, registration: true } });
    if (!inv || inv.event.mode !== "PRIVATE") throw new NotFoundError("الدعوة غير موجودة");
    const closed = rsvpClosedReason(inv.event);
    if (closed && closed !== "NOT_ACTIVE") throw new AppError("انتهت فترة الرد على هذه الدعوة");
    const reg = inv.registration;
    if (!reg) {
      const created = await tx.registration.create({
        data: {
          eventId: inv.eventId,
          invitationId: inv.id,
          source: "INVITATION",
          name: inv.name,
          contactMethod: inv.phone ? "WHATSAPP" : "EMAIL",
          phone: inv.phone,
          email: inv.email,
          status: "DECLINED",
          seats: 0,
          cancelledAt: new Date(),
          accessToken: randomToken(),
        },
      });
      return { accessToken: created.accessToken };
    }
    await cancelInTx(tx, reg, "DECLINED");
    return { accessToken: reg.accessToken };
  });
  return result;
}

// ───────── الرابط العام ─────────

export async function getPublicEvent(slug: string) {
  const event = await prisma.event.findUnique({ where: { publicSlug: slug }, include: { template: true } });
  if (!event || event.mode !== "PUBLIC") throw new NotFoundError("الفعالية غير موجودة");
  return event;
}

export async function registerPublic(params: {
  slug: string;
  contact: ContactInput;
  idempotencyKey?: string;
}): Promise<RsvpOutcome> {
  const contact = parseContact(params.contact);
  const settings = await getSettings();
  const idem = params.idempotencyKey && /^[A-Za-z0-9_-]{8,64}$/.test(params.idempotencyKey) ? params.idempotencyKey : null;
  let resendFor: string | null = null;

  const outcome = await runRsvp(async (tx): Promise<RsvpOutcome> => {
    resendFor = null;
    const event = await tx.event.findUnique({ where: { publicSlug: params.slug } });
    if (!event || event.mode !== "PUBLIC") throw new NotFoundError("الفعالية غير موجودة");
    const closed = rsvpClosedReason(event);
    if (closed) return { status: "CLOSED", reason: closed };

    // نفس النموذج أُرسل مرة أخرى (ضغط متكرر/إعادة تحميل) → نفس النتيجة
    if (idem) {
      const same = await tx.registration.findUnique({ where: { eventId_idempotencyKey: { eventId: event.id, idempotencyKey: idem } } });
      if (same) {
        if (same.status === "CONFIRMED") return { status: "CONFIRMED", accessToken: same.accessToken, already: true };
        if (same.status === "WAITLISTED" || same.status === "OFFERED")
          return { status: "WAITLISTED", accessToken: same.accessToken, already: true };
      }
    }

    const dedupeKey = dedupeKeyFor(contact);
    const existing = await tx.registration.findUnique({ where: { eventId_dedupeKey: { eventId: event.id, dedupeKey } } });
    if (existing && ["CONFIRMED", "WAITLISTED", "OFFERED"].includes(existing.status)) {
      // لا نعرض التذكرة لمن كتب وسيلة تواصل مسجلة؛ نعيد إرسالها لصاحبها فقط
      if (existing.status === "CONFIRMED") resendFor = existing.id;
      return { status: "ALREADY_REGISTERED", resent: existing.status === "CONFIRMED", waitlisted: existing.status !== "CONFIRMED" };
    }

    const ok = await reserveSeats(tx, event.id, 1);
    const now = new Date();
    if (!ok) {
      if (event.fullPolicy !== "WAITLIST") return { status: "FULL" };
      const data = {
        name: contact.name,
        contactMethod: contact.contactMethod,
        phone: contact.phone,
        email: contact.email,
        seats: 0,
        seatsRequested: 1,
        status: "WAITLISTED",
        idempotencyKey: idem,
        cancelledAt: null,
      };
      const w = existing
        ? await guardedUpdate(tx, existing, data)
        : await tx.registration.create({
            data: { ...data, eventId: event.id, source: "PUBLIC", dedupeKey, accessToken: randomToken() },
          });
      return { status: "WAITLISTED", accessToken: w.accessToken, already: false };
    }

    const data = {
      name: contact.name,
      contactMethod: contact.contactMethod,
      phone: contact.phone,
      email: contact.email,
      seats: 1,
      seatsRequested: 1,
      status: "CONFIRMED",
      confirmedAt: now,
      cancelledAt: null,
      idempotencyKey: idem,
    };
    const reg = existing
      ? await guardedUpdate(tx, existing, data)
      : await tx.registration.create({
          data: { ...data, eventId: event.id, source: "PUBLIC", dedupeKey, accessToken: randomToken() },
        });
    await finalizeConfirmed(tx, event, reg, settings);
    return { status: "CONFIRMED", accessToken: reg.accessToken, already: false };
  });

  if (outcome.status === "ALREADY_REGISTERED" && resendFor) {
    const resent = await resendTicket(resendFor, settings);
    await kickOutbox();
    return { ...outcome, resent };
  }
  await kickOutbox();
  return outcome;
}

/** إعادة إرسال التذكرة لوسيلة التواصل المسجلة (بحد أدنى للمدة بين كل إرسال) */
export async function resendTicket(registrationId: string, settings?: OperatingSettings): Promise<boolean> {
  const s = settings ?? (await getSettings());
  return withTx(async (tx) => {
    const reg = await tx.registration.findUnique({ where: { id: registrationId }, include: { event: true } });
    if (!reg || reg.status !== "CONFIRMED") return false;
    const cooldown = s.ticketResendCooldownMinutes * 60 * 1000;
    const since = new Date(Date.now() - cooldown);
    const guard = await tx.registration.updateMany({
      where: { id: reg.id, OR: [{ lastTicketResendAt: null }, { lastTicketResendAt: { lt: since } }] },
      data: { lastTicketResendAt: new Date() },
    });
    if (guard.count === 0) return false;
    const tickets = await tx.ticket.findMany({ where: { registrationId: reg.id, status: "ACTIVE" } });
    const msg = composeTicketResend(reg.event, reg, tickets);
    const recipient = reg.contactMethod === "WHATSAPP" ? reg.phone : reg.email;
    if (!recipient) return false;
    await enqueuePackageMessage(tx, {
      ownerId: reg.event.ownerId,
      eventId: reg.eventId,
      registrationId: reg.id,
      kind: "TICKET_RESEND",
      channel: reg.contactMethod as "WHATSAPP" | "EMAIL",
      recipient,
      subject: msg.subject,
      body: msg.body,
      idempotencyKey: `resend:${reg.id}:${Date.now()}`,
      settings: s,
    });
    return true;
  });
}

// ───────── صفحة الضيف: الاعتذار وقائمة الانتظار ─────────

export async function getRegistrationByAccessToken(accessToken: string) {
  const reg = await prisma.registration.findUnique({
    where: { accessToken },
    include: {
      event: { include: { template: true } },
      invitation: true,
      tickets: { where: { status: "ACTIVE" }, orderBy: { kind: "desc" } },
    },
  });
  if (!reg) throw new NotFoundError("الرابط غير صحيح");
  // انتهاء فرصة الانتظار عند فتح الصفحة
  if (reg.status === "OFFERED" && reg.offerExpiresAt && reg.offerExpiresAt < new Date()) {
    await prisma.registration.updateMany({ where: { id: reg.id, status: "OFFERED" }, data: { status: "WAITLISTED" } });
    reg.status = "WAITLISTED";
  }
  return reg;
}

async function cancelInTx(tx: Tx, reg: Registration, finalStatus: "CANCELLED" | "DECLINED") {
  if (reg.status === "CANCELLED" || reg.status === "DECLINED") return;
  if (reg.status === "CONFIRMED") {
    const attended = await tx.ticket.count({ where: { registrationId: reg.id, checkedInAt: { not: null } } });
    if (attended > 0) throw new AppError("لا يمكن الاعتذار بعد تسجيل الحضور");
  }
  const res = await tx.registration.updateMany({
    where: { id: reg.id, status: reg.status },
    data: { status: finalStatus, seats: 0, cancelledAt: new Date(), offeredAt: null, offerExpiresAt: null },
  });
  if (res.count !== 1) return; // أُلغي بالتزامن
  if (reg.status === "CONFIRMED") {
    await releaseSeats(tx, reg.eventId, reg.seats);
    await cancelTickets(tx, reg.id);
  }
}

export async function cancelByGuest(accessToken: string) {
  await withTx(async (tx) => {
    const reg = await tx.registration.findUnique({ where: { accessToken } });
    if (!reg) throw new NotFoundError("الرابط غير صحيح");
    await cancelInTx(tx, reg, reg.source === "INVITATION" ? "DECLINED" : "CANCELLED");
  });
}

export async function cancelByOrganizer(ownerId: string, registrationId: string) {
  await withTx(async (tx) => {
    const reg = await tx.registration.findFirst({ where: { id: registrationId, event: { ownerId } } });
    if (!reg) throw new NotFoundError("التسجيل غير موجود");
    await cancelInTx(tx, reg, reg.source === "INVITATION" ? "DECLINED" : "CANCELLED");
    await audit(tx, { actorId: ownerId, action: "registration.cancel", entityType: "Registration", entityId: reg.id });
  });
}

async function claimOfferInTx(
  tx: Tx,
  event: Event,
  reg: Registration,
  opts: { withCompanion: boolean; contact?: ReturnType<typeof parseContact>; settings: OperatingSettings },
): Promise<RsvpOutcome> {
  if (reg.offerExpiresAt && reg.offerExpiresAt < new Date()) {
    await tx.registration.updateMany({ where: { id: reg.id, status: "OFFERED" }, data: { status: "WAITLISTED" } });
    return { status: "OFFER_EXPIRED", accessToken: reg.accessToken };
  }
  let allowCompanion = reg.seatsRequested >= 2;
  if (reg.invitationId) {
    const inv = await tx.invitation.findUnique({ where: { id: reg.invitationId } });
    allowCompanion = !!inv?.allowCompanion;
  }
  const want = opts.withCompanion && allowCompanion ? 2 : 1;
  const ok = await reserveSeats(tx, event.id, want);
  if (!ok) {
    const fresh = await tx.event.findUniqueOrThrow({ where: { id: event.id } });
    if (want === 2 && availableSeats(fresh) === 1) return { status: "ONLY_ONE_LEFT" };
    await tx.registration.updateMany({ where: { id: reg.id, status: "OFFERED" }, data: { status: "WAITLISTED" } });
    return { status: "OFFER_UNAVAILABLE", accessToken: reg.accessToken };
  }
  const data: Partial<Registration> = {
    status: "CONFIRMED",
    seats: want,
    withCompanion: want === 2,
    confirmedAt: new Date(),
    offerExpiresAt: null,
  };
  if (opts.contact) Object.assign(data, opts.contact);
  const confirmed = await guardedUpdate(tx, reg, data);
  await finalizeConfirmed(tx, event, confirmed, opts.settings);
  return { status: "CONFIRMED", accessToken: confirmed.accessToken, already: false };
}

/** الضيف يؤكد فرصة قائمة الانتظار من صفحته */
export async function claimOffer(accessToken: string, withCompanion: boolean): Promise<RsvpOutcome> {
  const settings = await getSettings();
  const outcome = await runRsvp(async (tx): Promise<RsvpOutcome> => {
    const reg = await tx.registration.findUnique({ where: { accessToken }, include: { event: true } });
    if (!reg) throw new NotFoundError("الرابط غير صحيح");
    const closed = rsvpClosedReason(reg.event);
    if (closed) return { status: "CLOSED", reason: closed };
    if (reg.status === "CONFIRMED") return { status: "CONFIRMED", accessToken, already: true };
    if (reg.status !== "OFFERED") throw new AppError("لا توجد فرصة تأكيد مفتوحة لهذا التسجيل");
    return claimOfferInTx(tx, reg.event, reg, { withCompanion, settings });
  });
  await kickOutbox();
  return outcome;
}

/** إعادة الفرص المنتهية إلى قائمة الانتظار (يُستدعى من العامل المجدول) */
export async function expireOffers() {
  const res = await prisma.registration.updateMany({
    where: { status: "OFFERED", offerExpiresAt: { lt: new Date() } },
    data: { status: "WAITLISTED" },
  });
  return res.count;
}
