import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { AppError, NotFoundError, ForbiddenError } from "@/lib/errors";
import { localInputToDate, DEFAULT_TZ } from "@/lib/format";
import { audit } from "@/lib/audit";
import type { Event } from "@prisma/client";

// ───────── الصلاحيات وعزل البيانات ─────────

/** يعيد الفعالية فقط إذا كان المستخدم مالكها — وإلا "غير موجودة" (لا نكشف وجودها) */
export async function getOwnedEvent(eventId: string, userId: string, db: Db = prisma): Promise<Event> {
  const event = await db.event.findFirst({ where: { id: eventId, ownerId: userId } });
  if (!event) throw new NotFoundError("الفعالية غير موجودة");
  return event;
}

/** هل يستطيع المستخدم العمل على استقبال هذه الفعالية؟ (المالك أو عضو فريق معيّن) */
export async function canWorkCheckIn(userId: string, eventId: string, db: Db = prisma): Promise<boolean> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { ownerId: true } });
  if (!event) return false;
  if (event.ownerId === userId) return true;
  const staff = await db.eventStaff.findUnique({ where: { eventId_userId: { eventId, userId } } });
  return !!staff;
}

export async function assertCheckInAccess(userId: string, eventId: string, db: Db = prisma) {
  if (!(await canWorkCheckIn(userId, eventId, db))) {
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
export async function requiredPrivatePlaces(eventId: string, db: Db = prisma): Promise<number> {
  const [total, withCompanion] = await Promise.all([
    db.invitation.count({ where: { eventId } }),
    db.invitation.count({ where: { eventId, allowCompanion: true } }),
  ]);
  return total + withCompanion;
}

export async function requiredPlaces(event: Pick<Event, "id" | "mode" | "capacity">, db: Db = prisma) {
  return event.mode === "PUBLIC" ? event.capacity : requiredPrivatePlaces(event.id, db);
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
  const event = await prisma.event.create({
    data: {
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
    },
  });
  await audit(prisma, { actorId: ownerId, action: "event.create", entityType: "Event", entityId: event.id });
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
  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
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
    },
  });
  await audit(prisma, { actorId: ownerId, action: "event.update", entityType: "Event", entityId: event.id });
  return updated;
}

export async function setEventTemplate(ownerId: string, eventId: string, templateId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  const template = await prisma.template.findFirst({
    where: {
      id: templateId,
      status: "ACTIVE",
      OR: [{ visibility: "PUBLIC" }, { visibility: "PRIVATE", ownerId }],
    },
  });
  if (!template) throw new NotFoundError("القالب غير متاح");
  return prisma.event.update({ where: { id: event.id }, data: { templateId: template.id } });
}

export async function cancelEvent(ownerId: string, eventId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status === "CANCELLED") return event;
  const updated = await prisma.event.update({ where: { id: event.id }, data: { status: "CANCELLED" } });
  await prisma.scheduledJob.updateMany({
    where: { eventId: event.id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  await audit(prisma, { actorId: ownerId, action: "event.cancel", entityType: "Event", entityId: event.id });
  return updated;
}

export async function deleteDraftEvent(ownerId: string, eventId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  if (event.status !== "DRAFT" || event.paidPlaces > 0) throw new AppError("يمكن حذف المسودات غير المدفوعة فقط");
  const payments = await prisma.payment.count({ where: { eventId: event.id } });
  if (payments > 0) {
    await prisma.payment.updateMany({ where: { eventId: event.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    throw new AppError("للمسودة عمليات دفع مسجلة، لذلك أُلغيت بدل حذفها. يمكنك إلغاء الفعالية.");
  }
  await prisma.event.delete({ where: { id: event.id } });
  await audit(prisma, { actorId: ownerId, action: "event.delete", entityType: "Event", entityId: event.id });
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

export async function eventStats(event: Event, db: Db = prisma): Promise<EventStats> {
  const [
    invitations,
    invitationsWithCompanion,
    notSent,
    deliveryFailed,
    invitedWithoutResponse,
    regGroups,
    confirmedPeople,
    attendedGuests,
    attendedCompanions,
  ] = await Promise.all([
    db.invitation.count({ where: { eventId: event.id } }),
    db.invitation.count({ where: { eventId: event.id, allowCompanion: true } }),
    db.invitation.count({ where: { eventId: event.id, deliveryStatus: "NOT_SENT" } }),
    db.invitation.count({ where: { eventId: event.id, deliveryStatus: "FAILED" } }),
    db.invitation.count({ where: { eventId: event.id, registration: null } }),
    db.registration.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
    db.registration.aggregate({ where: { eventId: event.id, status: "CONFIRMED" }, _sum: { seats: true } }),
    db.ticket.count({ where: { eventId: event.id, kind: "PRIMARY", checkedInAt: { not: null } } }),
    db.ticket.count({ where: { eventId: event.id, kind: "COMPANION", checkedInAt: { not: null } } }),
  ]);
  const byStatus = Object.fromEntries(regGroups.map((g) => [g.status, g._count._all])) as Record<string, number>;
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
