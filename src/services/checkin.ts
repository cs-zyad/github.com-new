import { prisma, withTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { phoneSearchFragment, normalizeEmail } from "@/lib/contact";
import { assertCheckInAccess } from "./events";

export type CheckInResult =
  | {
      result: "SUCCESS" | "ALREADY";
      ticketId: string;
      holderName: string;
      kind: string;
      primaryName: string;
      checkedInAt: Date;
      method: string;
    }
  | { result: "INVALID" | "WRONG_EVENT" | "CANCELLED"; message: string };

/** استخراج رمز التذكرة من نص المسح (الرمز نفسه أو رابط صفحة التذكرة) */
export function extractTicketCode(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = /\/t\/(W1[A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  if (/^W1[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

/**
 * مسار تسجيل الحضور الوحيد — يستخدمه المسح والتسجيل اليدوي.
 * التحديث الشرطي (checkedInAt IS NULL) يضمن عدم تكرار الحضور حتى مع مسحين متزامنين.
 */
export async function checkIn(params: {
  staffUserId: string;
  eventId: string;
  method: "SCAN" | "MANUAL";
  code?: string;
  ticketId?: string;
}): Promise<CheckInResult> {
  await assertCheckInAccess(params.staffUserId, params.eventId);

  return withTx(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: params.eventId } });
    if (!event || event.status !== "ACTIVE") throw new AppError("الفعالية غير نشطة");

    const ticket = params.ticketId
      ? await tx.ticket.findUnique({ where: { id: params.ticketId }, include: { registration: true } })
      : params.code
        ? await tx.ticket.findUnique({ where: { code: params.code }, include: { registration: true } })
        : null;

    const log = (result: string, ticketId?: string) =>
      tx.checkInLog.create({
        data: { eventId: params.eventId, ticketId: ticketId ?? null, staffId: params.staffUserId, method: params.method, result },
      });

    if (!ticket) {
      await log("INVALID");
      return { result: "INVALID", message: "رمز غير صالح" } as const;
    }
    if (ticket.eventId !== params.eventId) {
      // لا نكشف بيانات تذكرة تابعة لفعالية أخرى
      await log("WRONG_EVENT");
      return { result: "WRONG_EVENT", message: "التذكرة لا تخص هذه الفعالية" } as const;
    }
    if (ticket.status !== "ACTIVE" || ticket.registration.status !== "CONFIRMED") {
      await log("CANCELLED", ticket.id);
      return { result: "CANCELLED", message: "التذكرة ملغاة (اعتذر صاحبها أو أُلغي تسجيله)" } as const;
    }

    const now = new Date();
    const updated = await tx.ticket.updateMany({
      where: { id: ticket.id, checkedInAt: null, status: "ACTIVE" },
      data: { checkedInAt: now, checkedInById: params.staffUserId, checkInMethod: params.method },
    });
    const fresh = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const result = updated.count === 1 ? "SUCCESS" : "ALREADY";
    await log(result, ticket.id);
    return {
      result,
      ticketId: ticket.id,
      holderName: fresh.holderName,
      kind: fresh.kind,
      primaryName: ticket.registration.name,
      checkedInAt: fresh.checkedInAt!,
      method: fresh.checkInMethod ?? params.method,
    } as const;
  });
}

/** البحث اليدوي — مقيّد بتذاكر الفعالية المحددة فقط */
export async function searchTickets(staffUserId: string, eventId: string, query: string) {
  await assertCheckInAccess(staffUserId, eventId);
  const q = query.trim();
  if (q.length < 2) return [];
  const phoneFrag = phoneSearchFragment(q);
  const email = normalizeEmail(q);
  const regOr: object[] = [{ name: { contains: q } }];
  if (phoneFrag) regOr.push({ phone: { contains: phoneFrag } });
  if (email) regOr.push({ email });
  else if (q.includes("@")) regOr.push({ email: { contains: q.toLowerCase() } });

  const tickets = await prisma.ticket.findMany({
    where: {
      eventId,
      status: "ACTIVE",
      registration: { status: "CONFIRMED", OR: regOr },
    },
    include: { registration: { select: { name: true, phone: true, email: true } }, checkedInBy: { select: { name: true } } },
    orderBy: [{ registrationId: "asc" }, { kind: "desc" }],
    take: 30,
  });
  return tickets.map((t) => ({
    ticketId: t.id,
    kind: t.kind,
    holderName: t.holderName,
    primaryName: t.registration.name,
    phone: t.registration.phone,
    email: t.registration.email,
    checkedInAt: t.checkedInAt,
    checkInMethod: t.checkInMethod,
    checkedInBy: t.checkedInBy?.name ?? null,
  }));
}

export async function checkInSummary(eventId: string) {
  const [attended, totalTickets, recent] = await Promise.all([
    prisma.ticket.count({ where: { eventId, status: "ACTIVE", checkedInAt: { not: null } } }),
    prisma.ticket.count({ where: { eventId, status: "ACTIVE" } }),
    prisma.ticket.findMany({
      where: { eventId, checkedInAt: { not: null } },
      orderBy: { checkedInAt: "desc" },
      take: 8,
      include: { registration: { select: { name: true } }, checkedInBy: { select: { name: true } } },
    }),
  ]);
  return { attended, totalTickets, recent };
}
