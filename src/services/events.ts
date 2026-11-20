import { z } from "zod";
import { C, col, ref, getDoc, getDocs, count, newId, db, uniqueRef as uniqueRefFor } from "@/lib/firestore";
import { AppError, NotFoundError, ForbiddenError } from "@/lib/errors";
import { localInputToDate, DEFAULT_TZ } from "@/lib/format";
import { audit } from "@/lib/audit";
import type { Event, ScheduledJob } from "@/lib/types";

// ───────── الصلاحيات وعزل البيانات ─────────

/** يعيد الفعالية فقط إذا كان المستخدم مالكها — وإلا "غير موجودة" (لا نكشف وجودها) */
export async function getOwnedEvent(eventId: string, userId: string): Promise<Event> {
  const event = await getDoc<Event>(C.events, eventId);
  if (!event || event.ownerId !== userId) throw new NotFoundError("الفعالية غير موجودة");
  return event;
}

export const staffDocId = (eventId: string, userId: string) => `${eventId}_${userId}`;

/** هل يستطيع المستخدم العمل على استقبال هذه الفعالية؟ (المالك أو عضو فريق معيّن) */
export async function canWorkCheckIn(userId: string, eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const event = await getDoc<Event>(C.events, eventId);
  if (!event) return false;
  if (event.ownerId === userId) return true;
  const staff = await ref(C.eventStaff, staffDocId(eventId, userId)).get();
  return staff.exists;
}

export async function assertCheckInAccess(userId: string, eventId: string) {
  if (!(await canWorkCheckIn(userId, eventId))) {
    throw new ForbiddenError("لست ضمن فريق الاستقبال لهذه الفعالية");
  }
}

// ───────── السعة ─────────

/**
 * الحد الفعلي للمقاعد:
 * - الخاصة: الحد الأقصى للحضور (الباقة تغطي عدد الدعوات المرسلة وتُدفع قبل الإرسال)
 * - العامة: الأقل بين الحد الأقصى للحضور والأماكن المدفوعة
 */
export function seatLimit(e: Pick<Event, "mode" | "capacity" | "paidPlaces">): number {
  return e.mode === "PUBLIC" ? Math.min(e.capacity, e.paidPlaces) : e.capacity;
}

export function availableSeats(e: Pick<Event, "mode" | "capacity" | "paidPlaces" | "reservedSeats">): number {
  return Math.max(0, seatLimit(e) - e.reservedSeats);
}

/** الأماكن المطلوبة للباقة في الفعالية الخاصة: دعوة = مكان، ودعوة بمرافق = مكانان */
export async function requiredPrivatePlaces(eventId: string): Promise<number> {
  const invs = col(C.invitations).where("eventId", "==", eventId);
  const [total, withCompanion] = await Promise.all([count(invs), count(invs.where("allowCompanion", "==", true))]);
  return total + withCompanion;
}

export async function requiredPlaces(event: Pick<Event, "id" | "mode" | "capacity">) {
  return event.mode === "PUBLIC" ? event.capacity : requiredPrivatePlaces(event.id);
}

// ───────── الإنشاء والتعديل ─────────

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => !v || /^https?:\/\//i.test(v), "رابط الموقع يجب أن يبدأ بـ http:// أو https://");

export const eventInputSchema = z.object({
  title: z.string().trim().min(3, "اكتب اسم الفعالية (3 أحرف على الأقل)").max(120),
  hostName: z.string().trim().max(120).default(""),
  description: z.string().trim().max(2000).default(""),
  startsAt: z.string().min(1, "حدّد موعد بداية الفعالية"),
  endsAt: z.string().optional().default(""),
  venueName: z.string().trim().min(2, "اكتب اسم المكان").max(160),
  venueAddress: z.string().trim().max(300).default(""),
  mapUrl: optionalUrl,
  mode: z.enum(["PRIVATE", "PUBLIC"], { message: "اختر نوع الدعوة" }),
  capacity: z.coerce
    .number({ message: "حدّد الحد الأقصى للحضور" })
    .int("الحد الأقصى يجب أن يكون رقمًا صحيحًا")
    .min(1, "الحد الأقصى للحضور يجب أن يكون 1 على الأقل")
    .max(100000),
  fullPolicy: z.enum(["CLOSE", "WAITLIST"], { message: "اختر سياسة اكتمال العدد" }),
});

export type EventInput = z.input<typeof eventInputSchema>;

function parseEventInput(input: EventInput) {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "بيانات غير صالحة");
  const d = parsed.data;
  const startsAt = localInputToDate(d.startsAt, DEFAULT_TZ);
  if (!startsAt) throw new AppError("صيغة موعد البداية غير صحيحة");
  const endsAt = d.endsAt ? localInputToDate(d.endsAt, DEFAULT_TZ) : null;
  if (d.endsAt && !endsAt) throw new AppError("صيغة موعد النهاية غير صحيحة");
  if (endsAt && endsAt <= startsAt) throw new AppError("موعد النهاية يجب أن يكون بعد البداية");
  return { ...d, startsAt, endsAt };
}

export async function createEvent(ownerId: string, input: EventInput) {
  const d = parseEventInput(input);
  if (d.startsAt.getTime() < Date.now() - 60_000) throw new AppError("موعد الفعالية يجب أن يكون في المستقبل");
  const now = new Date();
  const id = newId();
  const event: Event = {
      id,
      ownerId,
      title: d.title,
      hostName: d.hostName,
      description: d.description,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      timezone: DEFAULT_TZ,
      venueName: d.venueName,
      venueAddress: d.venueAddress,
      mapUrl: d.mapUrl,
      mode: d.mode,
      capacity: d.capacity,
      fullPolicy: d.fullPolicy,
      status: "DRAFT",
      templateId: null,
      paidPlaces: 0,
      reservedSeats: 0,
      publicSlug: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
  };
  const { id: _omit, ...data } = event;
  void _omit;
  await ref(C.events, id).set(data);
  await audit({ actorId: ownerId, action: "event.create", entityType: "Event", entityId: id });
  return event;
}

export async function updateEvent(ownerId: string, eventId: string, input: EventInput) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status === "CANCELLED" || event.status === "ENDED") throw new AppError("لا يمكن تعديل فعالية منتهية أو ملغاة");
  const d = parseEventInput(input);
  const paid = event.paidPlaces > 0;
  if (paid && d.mode !== event.mode) throw new AppError("لا يمكن تغيير نوع الدعوة بعد دفع الباقة");
  if (d.capacity < event.reservedSeats) {
    throw new AppError(`لا يمكن جعل الحد الأقصى أقل من المقاعد المحجوزة حاليًا (${event.reservedSeats})`);
  }
  if (event.mode === "PUBLIC" && paid && d.capacity > event.paidPlaces) {
    throw new AppError(
      `الحد الأقصى أكبر من الأماكن المدفوعة (${event.paidPlaces}). اشترِ أماكن إضافية من صفحة الباقة لرفع السعة.`,
    );
  }
  const patch = {
      title: d.title,
      hostName: d.hostName,
      description: d.description,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      venueName: d.venueName,
      venueAddress: d.venueAddress,
      mapUrl: d.mapUrl,
      mode: d.mode,
      capacity: d.capacity,
      fullPolicy: d.fullPolicy,
      updatedAt: new Date(),
  };
  // السعة تُعدّل بمعاملة حتى لا تقل عن المقاعد المحجوزة لحظة الحفظ
  await db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref(C.events, event.id))).data() as Event;
    if (d.capacity < cur.reservedSeats) {
      throw new AppError(`لا يمكن جعل الحد الأقصى أقل من المقاعد المحجوزة حاليًا (${cur.reservedSeats})`);
    }
    tx.update(ref(C.events, event.id), patch);
  });
  await audit({ actorId: ownerId, action: "event.update", entityType: "Event", entityId: event.id });
  return { ...event, ...patch };
}

export async function setEventTemplate(ownerId: string, eventId: string, templateId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  const template = await getDoc<{ id: string; status: string; visibility: string; ownerId: string | null }>(C.templates, templateId);
  const allowed =
    template && template.status === "ACTIVE" && (template.visibility === "PUBLIC" || (template.visibility === "PRIVATE" && template.ownerId === ownerId));
  if (!template || !allowed) throw new NotFoundError("القالب غير متاح");
  await ref(C.events, event.id).update({ templateId: template.id, updatedAt: new Date() });
  return { ...event, templateId: template.id };
}

export async function cancelEvent(ownerId: string, eventId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status === "CANCELLED") return event;
  await ref(C.events, event.id).update({ status: "CANCELLED", updatedAt: new Date() });
  const jobs = await getDocs<ScheduledJob>(col(C.scheduledJobs).where("eventId", "==", event.id).where("status", "==", "PENDING"));
  for (const j of jobs) await ref(C.scheduledJobs, j.id).update({ status: "CANCELLED", finishedAt: new Date() });
  await audit({ actorId: ownerId, action: "event.cancel", entityType: "Event", entityId: event.id });
  return { ...event, status: "CANCELLED" };
}

export async function deleteDraftEvent(ownerId: string, eventId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status !== "DRAFT" || event.paidPlaces > 0) throw new AppError("يمكن حذف المسودات غير المدفوعة فقط");
  const payments = await getDocs<{ id: string; status: string }>(col(C.payments).where("eventId", "==", event.id));
  if (payments.length > 0) {
    for (const p of payments) if (p.status === "PENDING") await ref(C.payments, p.id).update({ status: "CANCELLED", updatedAt: new Date() });
    throw new AppError("للمسودة عمليات دفع مسجلة، لذلك أُلغيت بدل حذفها. يمكنك إلغاء الفعالية.");
  }
  // حذف المسودة ومدعويها وقيودهم الفريدة
  const invs = await col(C.invitations).where("eventId", "==", event.id).get();
  const writer = db().bulkWriter();
  for (const d of invs.docs) {
    const inv = d.data() as { phone: string | null; email: string | null };
    if (inv.phone) writer.delete(uniqueRefFor(`inv-phone:${event.id}:${inv.phone}`));
    if (inv.email) writer.delete(uniqueRefFor(`inv-email:${event.id}:${inv.email}`));
    writer.delete(d.ref);
  }
  writer.delete(ref(C.events, event.id));
  await writer.close();
  await audit({ actorId: ownerId, action: "event.delete", entityType: "Event", entityId: event.id });
}

// ───────── الإحصاءات ─────────

export type EventStats = {
  invitations: number;
  invitationPeople: number;
  notSent: number;
  deliveryFailed: number;
  notConfirmed: number;
  confirmedRegistrations: number;
  confirmedPeople: number;
  attendedPeople: number;
  attendedGuests: number;
  attendedCompanions: number;
  waitlisted: number;
  offered: number;
  declined: number;
  reservedSeats: number;
  seatLimit: number;
  availableSeats: number;
  paidPlaces: number;
  requiredPlaces: number;
};

export async function eventStats(event: Event): Promise<EventStats> {
  const invs = col(C.invitations).where("eventId", "==", event.id);
  const regs = col(C.registrations).where("eventId", "==", event.id);
  const tickets = col(C.tickets).where("eventId", "==", event.id).where("checkedIn", "==", true);
  const statuses = ["CONFIRMED", "WAITLISTED", "OFFERED", "CANCELLED", "DECLINED"];
  const [invitations, invitationsWithCompanion, notSent, deliveryFailed, invitedWithoutResponse, attendedGuests, attendedCompanions, ...regCounts] =
    await Promise.all([
      count(invs),
      count(invs.where("allowCompanion", "==", true)),
      count(invs.where("deliveryStatus", "==", "NOT_SENT")),
      count(invs.where("deliveryStatus", "==", "FAILED")),
      count(invs.where("regStatus", "==", null)),
      count(tickets.where("kind", "==", "PRIMARY")),
      count(tickets.where("kind", "==", "COMPANION")),
      ...statuses.map((st) => count(regs.where("status", "==", st))),
    ]);
  const byStatus = Object.fromEntries(statuses.map((st, i) => [st, regCounts[i]])) as Record<string, number>;
  const confirmedPeople = { _sum: { seats: event.reservedSeats } };
  const limit = seatLimit(event);
  return {
    invitations,
    invitationPeople: invitations + invitationsWithCompanion,
    notSent,
    deliveryFailed,
    notConfirmed: invitedWithoutResponse,
    confirmedRegistrations: byStatus.CONFIRMED ?? 0,
    confirmedPeople: confirmedPeople._sum.seats ?? 0,
    attendedPeople: attendedGuests + attendedCompanions,
    attendedGuests,
    attendedCompanions,
    waitlisted: byStatus.WAITLISTED ?? 0,
    offered: byStatus.OFFERED ?? 0,
    declined: (byStatus.DECLINED ?? 0) + (byStatus.CANCELLED ?? 0),
    reservedSeats: event.reservedSeats,
    seatLimit: limit,
    availableSeats: Math.max(0, limit - event.reservedSeats),
    paidPlaces: event.paidPlaces,
    requiredPlaces: event.mode === "PUBLIC" ? event.capacity : invitations + invitationsWithCompanion,
  };
}
