import { z } from "zod";
import { C, col, ref, getDoc, getDocs, getFirst, newId, runTx, txGet, uniqueRef, withoutId, type Transaction } from "@/lib/firestore";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { randomToken } from "@/lib/ids";
import { getSettings, type OperatingSettings } from "@/lib/settings";
import { auditTx } from "@/lib/audit";
import { availableSeats, seatLimit } from "./events";
import { readTickets, writeTickets, cancelTicketsWrite } from "./tickets";
import { composeConfirmation, composeTicketResend } from "./compose";
import { writePackageMessage, kickOutbox } from "./messaging";
import type { Event, Invitation, Registration, Template, Ticket } from "@/lib/types";

/**
 * التأكيد والسعة على Firestore:
 * كل عملية حجز معاملة واحدة تقرأ وثيقة الفعالية والتسجيل والتذاكر ثم تكتب.
 * Firestore يضمن العزل: معاملتان متزامنتان على نفس الفعالية لا تريان نفس العدد،
 * وإحداهما تُعاد تلقائيًا بالقيم الجديدة — فلا يتجاوز الحجز السعة.
 * التسجيل للدعوة الخاصة معرّفه ثابت (inv_<invitationId>) فلا يتكرر.
 */

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
type Contact = z.output<typeof contactSchema>;

function parseContact(input: ContactInput): Contact {
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

/** هل يتسع الحجز؟ (داخل المعاملة على وثيقة الفعالية المقروءة) */
function canReserve(event: Event, n: number) {
  return event.status === "ACTIVE" && event.reservedSeats + n <= seatLimit(event);
}

function nowFields() {
  return new Date();
}

/** بيانات تسجيل جديد */
function newRegistration(
  base: Partial<Registration> & Pick<Registration, "eventId" | "source" | "name" | "contactMethod" | "status">,
): Omit<Registration, "id"> {
  const now = nowFields();
  return {
    invitationId: null,
    phone: null,
    email: null,
    dedupeKey: null,
    idempotencyKey: null,
    withCompanion: false,
    seats: 0,
    seatsRequested: 1,
    accessToken: randomToken(),
    offeredAt: null,
    offerExpiresAt: null,
    confirmedAt: null,
    cancelledAt: null,
    lastTicketResendAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...base,
  } as Omit<Registration, "id">;
}

/**
 * كتابة تأكيد ناجح: حجز المقاعد + التسجيل + التذاكر + رسالة التأكيد (ضمن الباقة).
 * كل القراءات تمت مسبقًا داخل نفس المعاملة.
 */
function writeConfirmed(
  tx: Transaction,
  ctx: {
    event: Event;
    regId: string;
    reg: Omit<Registration, "id">;
    prevSeats: number;
    tickets: { primary: Ticket | null; companion: Ticket | null };
    invitation: Invitation | null;
    settings: OperatingSettings;
  },
) {
  const { event, regId, reg } = ctx;
  tx.update(ref(C.events, event.id), { reservedSeats: event.reservedSeats - ctx.prevSeats + reg.seats, updatedAt: new Date() });
  tx.set(ref(C.registrations, regId), reg);
  const issued = writeTickets(tx, ctx.tickets, { eventId: event.id, registrationId: regId, holderName: reg.name, withCompanion: reg.withCompanion });
  if (ctx.invitation) tx.update(ref(C.invitations, ctx.invitation.id), { regStatus: "CONFIRMED", registrationId: regId, updatedAt: new Date() });
  const msg = composeConfirmation(event, reg, issued);
  const recipient = reg.contactMethod === "WHATSAPP" ? reg.phone : reg.email;
  if (recipient) {
    writePackageMessage(tx, {
      ownerId: event.ownerId,
      eventId: event.id,
      registrationId: regId,
      kind: "CONFIRMATION",
      channel: reg.contactMethod as "WHATSAPP" | "EMAIL",
      recipient,
      subject: msg.subject,
      body: msg.body,
      idempotencyKey: `confirm:${regId}:${reg.confirmedAt?.getTime() ?? 0}`,
      settings: ctx.settings,
    });
  }
}

// ───────── الدعوة الخاصة ─────────

async function findInvitationByToken(token: string) {
  if (!token) return null;
  return getFirst<Invitation>(col(C.invitations).where("token", "==", token));
}

export async function getInvitationByToken(token: string) {
  const inv = await findInvitationByToken(token);
  if (!inv) throw new NotFoundError("الدعوة غير موجودة أو الرابط غير صحيح");
  const event = (await getDoc<Event>(C.events, inv.eventId))!;
  const template = await getDoc<Template>(C.templates, event.templateId);
  const registration = await getDoc<Registration>(C.registrations, `inv_${inv.id}`);
  return { ...inv, event: { ...event, template }, registration };
}

export async function confirmInvitation(params: {
  token: string;
  contact: ContactInput;
  withCompanion: boolean;
  /** عند بقاء مقعد واحد وطلب مقعدين: الانضمام لقائمة الانتظار بدل التأكيد منفردًا (إن كانت السياسة تسمح) */
  joinWaitlist?: boolean;
}): Promise<RsvpOutcome> {
  const contact = parseContact(params.contact);
  const settings = await getSettings();
  const found = await findInvitationByToken(params.token);
  if (!found) throw new NotFoundError("الدعوة غير موجودة");

  const outcome = await runTx(async (tx): Promise<RsvpOutcome> => {
    // ── القراءات ──
    const inv = await txGet<Invitation>(tx, ref(C.invitations, found.id));
    if (!inv) throw new NotFoundError("الدعوة غير موجودة");
    const event = await txGet<Event>(tx, ref(C.events, inv.eventId));
    if (!event || event.mode !== "PRIVATE") throw new NotFoundError("الدعوة غير موجودة");
    const regId = `inv_${inv.id}`;
    const reg = await txGet<Registration>(tx, ref(C.registrations, regId));
    const tickets = await readTickets(tx, regId);

    const closed = rsvpClosedReason(event);
    if (closed) return { status: "CLOSED", reason: closed };
    const want = params.withCompanion && inv.allowCompanion ? 2 : 1;

    if (reg?.status === "CONFIRMED") return { status: "CONFIRMED", accessToken: reg.accessToken, already: true };
    if (reg?.status === "WAITLISTED") return { status: "WAITLISTED", accessToken: reg.accessToken, already: true };
    if (reg?.status === "OFFERED") {
      return claimOfferInTx(tx, { event, reg, invitation: inv, tickets, withCompanion: want === 2, contact, settings });
    }

    // ── القرار ثم الكتابة ──
    const now = new Date();
    const base = {
      eventId: event.id,
      invitationId: inv.id,
      source: "INVITATION",
      name: contact.name,
      contactMethod: contact.contactMethod,
      phone: contact.phone,
      email: contact.email,
    };
    if (!canReserve(event, want)) {
      if (want === 2 && availableSeats(event) === 1 && !(params.joinWaitlist && event.fullPolicy === "WAITLIST")) {
        return { status: "ONLY_ONE_LEFT" };
      }
      if (event.fullPolicy === "WAITLIST") {
        const data = {
          ...(reg ? withoutId(reg) : newRegistration({ ...base, status: "WAITLISTED" })),
          ...base,
          withCompanion: want === 2,
          seats: 0,
          seatsRequested: want,
          status: "WAITLISTED",
          version: (reg?.version ?? 0) + 1,
          updatedAt: now,
        };
        tx.set(ref(C.registrations, regId), data);
        tx.update(ref(C.invitations, inv.id), { regStatus: "WAITLISTED", registrationId: regId, updatedAt: now });
        return { status: "WAITLISTED", accessToken: data.accessToken, already: false };
      }
      return { status: "FULL" };
    }

    const data: Omit<Registration, "id"> = {
      ...(reg ? withoutId(reg) : newRegistration({ ...base, status: "CONFIRMED" })),
      ...base,
      withCompanion: want === 2,
      seats: want,
      seatsRequested: want,
      status: "CONFIRMED",
      confirmedAt: now,
      cancelledAt: null,
      offeredAt: null,
      offerExpiresAt: null,
      version: (reg?.version ?? 0) + 1,
      updatedAt: now,
    };
    writeConfirmed(tx, { event, regId, reg: data, prevSeats: 0, tickets, invitation: inv, settings });
    return { status: "CONFIRMED", accessToken: data.accessToken, already: false };
  });
  await kickOutbox();
  return outcome;
}

export async function declineInvitation(token: string): Promise<{ accessToken: string }> {
  const found = await findInvitationByToken(token);
  if (!found) throw new NotFoundError("الدعوة غير موجودة");
  return runTx(async (tx) => {
    const inv = await txGet<Invitation>(tx, ref(C.invitations, found.id));
    if (!inv) throw new NotFoundError("الدعوة غير موجودة");
    const event = await txGet<Event>(tx, ref(C.events, inv.eventId));
    if (!event || event.mode !== "PRIVATE") throw new NotFoundError("الدعوة غير موجودة");
    const regId = `inv_${inv.id}`;
    const reg = await txGet<Registration>(tx, ref(C.registrations, regId));
    const tickets = await readTickets(tx, regId);
    const closed = rsvpClosedReason(event);
    if (closed && closed !== "NOT_ACTIVE") throw new AppError("انتهت فترة الرد على هذه الدعوة");
    if (!reg) {
      const data = newRegistration({
        eventId: inv.eventId,
        invitationId: inv.id,
        source: "INVITATION",
        name: inv.name,
        contactMethod: inv.phone ? "WHATSAPP" : "EMAIL",
        phone: inv.phone,
        email: inv.email,
        status: "DECLINED",
        cancelledAt: new Date(),
      });
      tx.set(ref(C.registrations, regId), data);
      tx.update(ref(C.invitations, inv.id), { regStatus: "DECLINED", registrationId: regId, updatedAt: new Date() });
      return { accessToken: data.accessToken };
    }
    writeCancel(tx, { reg, event, tickets, invitation: inv, finalStatus: "DECLINED" });
    return { accessToken: reg.accessToken };
  });
}

// ───────── الرابط العام ─────────

async function findEventBySlug(slug: string) {
  if (!slug) return null;
  return getFirst<Event>(col(C.events).where("publicSlug", "==", slug));
}

export async function getPublicEvent(slug: string) {
  const event = await findEventBySlug(slug);
  if (!event || event.mode !== "PUBLIC") throw new NotFoundError("الفعالية غير موجودة");
  return { ...event, template: await getDoc<Template>(C.templates, event.templateId) };
}

const dedupeUniqueKey = (eventId: string, key: string) => `reg-dedupe:${eventId}:${key}`;
const idemUniqueKey = (eventId: string, key: string) => `reg-idem:${eventId}:${key}`;

export async function registerPublic(params: { slug: string; contact: ContactInput; idempotencyKey?: string }): Promise<RsvpOutcome> {
  const contact = parseContact(params.contact);
  const settings = await getSettings();
  const idem = params.idempotencyKey && /^[A-Za-z0-9_-]{8,64}$/.test(params.idempotencyKey) ? params.idempotencyKey : null;
  const found = await findEventBySlug(params.slug);
  if (!found || found.mode !== "PUBLIC") throw new NotFoundError("الفعالية غير موجودة");
  let resendFor: string | null = null;

  const outcome = await runTx(async (tx): Promise<RsvpOutcome> => {
    resendFor = null;
    // ── القراءات ──
    const event = await txGet<Event>(tx, ref(C.events, found.id));
    if (!event || event.mode !== "PUBLIC") throw new NotFoundError("الفعالية غير موجودة");
    const dedupeKey = dedupeKeyFor(contact);
    const idemSnap = idem ? await tx.get(uniqueRef(idemUniqueKey(event.id, idem))) : null;
    const dedupeSnap = await tx.get(uniqueRef(dedupeUniqueKey(event.id, dedupeKey)));
    const sameId = idemSnap?.exists ? (idemSnap.data()!.ref as string) : null;
    const existingId = dedupeSnap.exists ? (dedupeSnap.data()!.ref as string) : null;
    const same = sameId ? await txGet<Registration>(tx, ref(C.registrations, sameId)) : null;
    const existing = existingId ? await txGet<Registration>(tx, ref(C.registrations, existingId)) : null;
    const tickets = existing ? await readTickets(tx, existing.id) : { primary: null, companion: null };

    const closed = rsvpClosedReason(event);
    if (closed) return { status: "CLOSED", reason: closed };

    // نفس النموذج أُرسل مرة أخرى (ضغط متكرر/إعادة تحميل) → نفس النتيجة
    if (same) {
      if (same.status === "CONFIRMED") return { status: "CONFIRMED", accessToken: same.accessToken, already: true };
      if (same.status === "WAITLISTED" || same.status === "OFFERED") return { status: "WAITLISTED", accessToken: same.accessToken, already: true };
    }
    if (existing && ["CONFIRMED", "WAITLISTED", "OFFERED"].includes(existing.status)) {
      // لا نعرض التذكرة لمن كتب وسيلة تواصل مسجلة؛ نعيد إرسالها لصاحبها فقط
      if (existing.status === "CONFIRMED") resendFor = existing.id;
      return { status: "ALREADY_REGISTERED", resent: existing.status === "CONFIRMED", waitlisted: existing.status !== "CONFIRMED" };
    }

    // ── القرار ثم الكتابة ──
    const now = new Date();
    const regId = existing?.id ?? newId();
    const base = {
      eventId: event.id,
      source: "PUBLIC",
      name: contact.name,
      contactMethod: contact.contactMethod,
      phone: contact.phone,
      email: contact.email,
      dedupeKey,
      idempotencyKey: idem,
    };
    const writeKeys = () => {
      if (!existing) tx.set(uniqueRef(dedupeUniqueKey(event.id, dedupeKey)), { ref: regId });
      if (idem) tx.set(uniqueRef(idemUniqueKey(event.id, idem)), { ref: regId });
    };

    if (!canReserve(event, 1)) {
      if (event.fullPolicy !== "WAITLIST") return { status: "FULL" };
      const data = {
        ...(existing ? withoutId(existing) : newRegistration({ ...base, status: "WAITLISTED" })),
        ...base,
        seats: 0,
        seatsRequested: 1,
        status: "WAITLISTED",
        cancelledAt: null,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
      };
      tx.set(ref(C.registrations, regId), data);
      writeKeys();
      return { status: "WAITLISTED", accessToken: data.accessToken, already: false };
    }

    const data: Omit<Registration, "id"> = {
      ...(existing ? withoutId(existing) : newRegistration({ ...base, status: "CONFIRMED" })),
      ...base,
      seats: 1,
      seatsRequested: 1,
      status: "CONFIRMED",
      confirmedAt: now,
      cancelledAt: null,
      version: (existing?.version ?? 0) + 1,
      updatedAt: now,
    };
    writeConfirmed(tx, { event, regId, reg: data, prevSeats: 0, tickets, invitation: null, settings });
    writeKeys();
    return { status: "CONFIRMED", accessToken: data.accessToken, already: false };
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
  return runTx(async (tx) => {
    const reg = await txGet<Registration>(tx, ref(C.registrations, registrationId));
    if (!reg || reg.status !== "CONFIRMED") return false;
    const event = await txGet<Event>(tx, ref(C.events, reg.eventId));
    const tickets = await readTickets(tx, reg.id);
    if (!event) return false;
    const cooldown = s.ticketResendCooldownMinutes * 60 * 1000;
    if (reg.lastTicketResendAt && Date.now() - reg.lastTicketResendAt.getTime() < cooldown) return false;
    const recipient = reg.contactMethod === "WHATSAPP" ? reg.phone : reg.email;
    if (!recipient) return false;
    const now = new Date();
    tx.update(ref(C.registrations, reg.id), { lastTicketResendAt: now, updatedAt: now });
    const active = [tickets.primary, tickets.companion].filter((t): t is Ticket => !!t && t.status === "ACTIVE");
    const msg = composeTicketResend(event, reg, active);
    writePackageMessage(tx, {
      ownerId: event.ownerId,
      eventId: reg.eventId,
      registrationId: reg.id,
      kind: "TICKET_RESEND",
      channel: reg.contactMethod as "WHATSAPP" | "EMAIL",
      recipient,
      subject: msg.subject,
      body: msg.body,
      idempotencyKey: `resend:${reg.id}:${now.getTime()}`,
      settings: s,
    });
    return true;
  });
}

// ───────── صفحة الضيف: الاعتذار وقائمة الانتظار ─────────

async function findRegistrationByAccessToken(accessToken: string) {
  if (!accessToken) return null;
  return getFirst<Registration>(col(C.registrations).where("accessToken", "==", accessToken));
}

export async function getRegistrationByAccessToken(accessToken: string) {
  let reg = await findRegistrationByAccessToken(accessToken);
  if (!reg) throw new NotFoundError("الرابط غير صحيح");
  // انتهاء فرصة الانتظار عند فتح الصفحة
  if (reg.status === "OFFERED" && reg.offerExpiresAt && reg.offerExpiresAt < new Date()) {
    await expireOne(reg.id);
    reg = (await getDoc<Registration>(C.registrations, reg.id))!;
  }
  const event = (await getDoc<Event>(C.events, reg.eventId))!;
  const template = await getDoc<Template>(C.templates, event.templateId);
  const invitation = await getDoc<Invitation>(C.invitations, reg.invitationId);
  const tickets = (await getDocs<Ticket>(col(C.tickets).where("registrationId", "==", reg.id)))
    .filter((t) => t.status === "ACTIVE")
    .sort((a, b) => (a.kind === "PRIMARY" ? -1 : b.kind === "PRIMARY" ? 1 : 0));
  return { ...reg, event: { ...event, template }, invitation, tickets };
}

/** كتابة الإلغاء/الاعتذار (بعد قراءة التسجيل والتذاكر والفعالية) */
function writeCancel(
  tx: Transaction,
  ctx: {
    reg: Registration;
    event: Event;
    tickets: { primary: Ticket | null; companion: Ticket | null };
    invitation: Invitation | null;
    finalStatus: "CANCELLED" | "DECLINED";
  },
) {
  const { reg, event, tickets } = ctx;
  if (reg.status === "CANCELLED" || reg.status === "DECLINED") return;
  if (reg.status === "CONFIRMED" && (tickets.primary?.checkedIn || tickets.companion?.checkedIn)) {
    throw new AppError("لا يمكن الاعتذار بعد تسجيل الحضور");
  }
  const now = new Date();
  tx.update(ref(C.registrations, reg.id), {
    status: ctx.finalStatus,
    seats: 0,
    cancelledAt: now,
    offeredAt: null,
    offerExpiresAt: null,
    version: reg.version + 1,
    updatedAt: now,
  });
  if (reg.status === "CONFIRMED") {
    tx.update(ref(C.events, event.id), { reservedSeats: Math.max(0, event.reservedSeats - reg.seats), updatedAt: now });
    cancelTicketsWrite(tx, tickets);
  }
  if (reg.invitationId) tx.update(ref(C.invitations, reg.invitationId), { regStatus: ctx.finalStatus, updatedAt: now });
}

async function cancelRegistration(regId: string, opts: { ownerId?: string }) {
  await runTx(async (tx) => {
    const reg = await txGet<Registration>(tx, ref(C.registrations, regId));
    if (!reg) throw new NotFoundError("التسجيل غير موجود");
    const event = await txGet<Event>(tx, ref(C.events, reg.eventId));
    if (!event || (opts.ownerId && event.ownerId !== opts.ownerId)) throw new NotFoundError("التسجيل غير موجود");
    const tickets = await readTickets(tx, reg.id);
    writeCancel(tx, { reg, event, tickets, invitation: null, finalStatus: reg.source === "INVITATION" ? "DECLINED" : "CANCELLED" });
    if (opts.ownerId) auditTx(tx, { actorId: opts.ownerId, action: "registration.cancel", entityType: "Registration", entityId: reg.id });
  });
}

export async function cancelByGuest(accessToken: string) {
  const reg = await findRegistrationByAccessToken(accessToken);
  if (!reg) throw new NotFoundError("الرابط غير صحيح");
  await cancelRegistration(reg.id, {});
}

export async function cancelByOrganizer(ownerId: string, registrationId: string) {
  await cancelRegistration(registrationId, { ownerId });
}

function claimOfferInTx(
  tx: Transaction,
  ctx: {
    event: Event;
    reg: Registration;
    invitation: Invitation | null;
    tickets: { primary: Ticket | null; companion: Ticket | null };
    withCompanion: boolean;
    contact?: Contact;
    settings: OperatingSettings;
  },
): RsvpOutcome {
  const { event, reg } = ctx;
  const now = new Date();
  if (reg.offerExpiresAt && reg.offerExpiresAt < now) {
    tx.update(ref(C.registrations, reg.id), { status: "WAITLISTED", version: reg.version + 1, updatedAt: now });
    if (reg.invitationId) tx.update(ref(C.invitations, reg.invitationId), { regStatus: "WAITLISTED", updatedAt: now });
    return { status: "OFFER_EXPIRED", accessToken: reg.accessToken };
  }
  const allowCompanion = ctx.invitation ? ctx.invitation.allowCompanion : reg.seatsRequested >= 2;
  const want = ctx.withCompanion && allowCompanion ? 2 : 1;
  if (!canReserve(event, want)) {
    if (want === 2 && availableSeats(event) === 1) return { status: "ONLY_ONE_LEFT" };
    tx.update(ref(C.registrations, reg.id), { status: "WAITLISTED", version: reg.version + 1, updatedAt: now });
    if (reg.invitationId) tx.update(ref(C.invitations, reg.invitationId), { regStatus: "WAITLISTED", updatedAt: now });
    return { status: "OFFER_UNAVAILABLE", accessToken: reg.accessToken };
  }
  const data: Omit<Registration, "id"> = {
    ...withoutId(reg),
    ...(ctx.contact ?? {}),
    status: "CONFIRMED",
    seats: want,
    withCompanion: want === 2,
    confirmedAt: now,
    offerExpiresAt: null,
    version: reg.version + 1,
    updatedAt: now,
  };
  writeConfirmed(tx, { event, regId: reg.id, reg: data, prevSeats: 0, tickets: ctx.tickets, invitation: ctx.invitation, settings: ctx.settings });
  return { status: "CONFIRMED", accessToken: reg.accessToken, already: false };
}

/** الضيف يؤكد فرصة قائمة الانتظار من صفحته */
export async function claimOffer(accessToken: string, withCompanion: boolean): Promise<RsvpOutcome> {
  const settings = await getSettings();
  const found = await findRegistrationByAccessToken(accessToken);
  if (!found) throw new NotFoundError("الرابط غير صحيح");
  const outcome = await runTx(async (tx): Promise<RsvpOutcome> => {
    const reg = await txGet<Registration>(tx, ref(C.registrations, found.id));
    if (!reg) throw new NotFoundError("الرابط غير صحيح");
    const event = (await txGet<Event>(tx, ref(C.events, reg.eventId)))!;
    const invitation = reg.invitationId ? await txGet<Invitation>(tx, ref(C.invitations, reg.invitationId)) : null;
    const tickets = await readTickets(tx, reg.id);
    const closed = rsvpClosedReason(event);
    if (closed) return { status: "CLOSED", reason: closed };
    if (reg.status === "CONFIRMED") return { status: "CONFIRMED", accessToken, already: true };
    if (reg.status !== "OFFERED") throw new AppError("لا توجد فرصة تأكيد مفتوحة لهذا التسجيل");
    return claimOfferInTx(tx, { event, reg, invitation, tickets, withCompanion, settings });
  });
  await kickOutbox();
  return outcome;
}

async function expireOne(regId: string) {
  await runTx(async (tx) => {
    const reg = await txGet<Registration>(tx, ref(C.registrations, regId));
    if (!reg || reg.status !== "OFFERED" || !reg.offerExpiresAt || reg.offerExpiresAt >= new Date()) return;
    tx.update(ref(C.registrations, reg.id), { status: "WAITLISTED", version: reg.version + 1, updatedAt: new Date() });
    if (reg.invitationId) tx.update(ref(C.invitations, reg.invitationId), { regStatus: "WAITLISTED", updatedAt: new Date() });
  });
}

/** إعادة الفرص المنتهية إلى قائمة الانتظار (يستدعيه العامل) */
export async function expireOffers() {
  const offered = await getDocs<Registration>(col(C.registrations).where("status", "==", "OFFERED"));
  const now = new Date();
  let n = 0;
  for (const r of offered) {
    if (r.offerExpiresAt && r.offerExpiresAt < now) {
      await expireOne(r.id);
      n++;
    }
  }
  return n;
}
