import { C, col, ref, getDoc, getDocs, getFirst, newId, runTx, txGet, count, byDate } from "@/lib/firestore";
import { AppError } from "@/lib/errors";
import { phoneSearchFragment, normalizeEmail, toLatinDigits } from "@/lib/contact";
import { assertCheckInAccess } from "./events";
import type { Event, Registration, Ticket, User } from "@/lib/types";

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
 * معاملة على وثيقة التذكرة: مسحان متزامنان لا يسجلان الحضور مرتين (الثاني يرى «حضر مسبقًا»).
 */
export async function checkIn(params: {
  staffUserId: string;
  eventId: string;
  method: "SCAN" | "MANUAL";
  code?: string;
  ticketId?: string;
}): Promise<CheckInResult> {
  await assertCheckInAccess(params.staffUserId, params.eventId);
  const staff = await getDoc<User>(C.users, params.staffUserId);

  const target = params.ticketId
    ? await getDoc<Ticket>(C.tickets, params.ticketId)
    : params.code
      ? await getFirst<Ticket>(col(C.tickets).where("code", "==", params.code))
      : null;

  return runTx(async (tx): Promise<CheckInResult> => {
    const event = await txGet<Event>(tx, ref(C.events, params.eventId));
    const ticket = target ? await txGet<Ticket>(tx, ref(C.tickets, target.id)) : null;
    const reg = ticket ? await txGet<Registration>(tx, ref(C.registrations, ticket.registrationId)) : null;
    if (!event || event.status !== "ACTIVE") throw new AppError("الفعالية غير نشطة");

    const log = (result: string, ticketId?: string) =>
      tx.set(ref(C.checkInLogs, newId()), {
        eventId: params.eventId,
        ticketId: ticketId ?? null,
        staffId: params.staffUserId,
        method: params.method,
        result,
        createdAt: new Date(),
      });

    if (!ticket || !reg) {
      log("INVALID");
      return { result: "INVALID", message: "رمز غير صالح" };
    }
    if (ticket.eventId !== params.eventId) {
      // لا نكشف بيانات تذكرة تابعة لفعالية أخرى
      log("WRONG_EVENT");
      return { result: "WRONG_EVENT", message: "التذكرة لا تخص هذه الفعالية" };
    }
    if (ticket.status !== "ACTIVE" || reg.status !== "CONFIRMED") {
      log("CANCELLED", ticket.id);
      return { result: "CANCELLED", message: "التذكرة ملغاة (اعتذر صاحبها أو أُلغي تسجيله)" };
    }
    if (ticket.checkedIn && ticket.checkedInAt) {
      log("ALREADY", ticket.id);
      return {
        result: "ALREADY",
        ticketId: ticket.id,
        holderName: ticket.holderName,
        kind: ticket.kind,
        primaryName: reg.name,
        checkedInAt: ticket.checkedInAt,
        method: ticket.checkInMethod ?? params.method,
      };
    }
    const now = new Date();
    tx.update(ref(C.tickets, ticket.id), {
      checkedIn: true,
      checkedInAt: now,
      checkedInById: params.staffUserId,
      checkedInByName: staff?.name ?? null,
      checkInMethod: params.method,
      updatedAt: now,
    });
    log("SUCCESS", ticket.id);
    return {
      result: "SUCCESS",
      ticketId: ticket.id,
      holderName: ticket.holderName,
      kind: ticket.kind,
      primaryName: reg.name,
      checkedInAt: now,
      method: params.method,
    };
  });
}

/** البحث اليدوي — مقيّد بتذاكر الفعالية المحددة فقط */
export async function searchTickets(staffUserId: string, eventId: string, query: string) {
  await assertCheckInAccess(staffUserId, eventId);
  const q = query.trim();
  if (q.length < 2) return [];
  const phoneFrag = phoneSearchFragment(q);
  const email = normalizeEmail(q);
  const lower = toLatinDigits(q).toLowerCase();

  const [regs, tickets] = await Promise.all([
    getDocs<Registration>(col(C.registrations).where("eventId", "==", eventId).where("status", "==", "CONFIRMED")),
    getDocs<Ticket>(col(C.tickets).where("eventId", "==", eventId).where("status", "==", "ACTIVE")),
  ]);
  const matched = new Map(
    regs
      .filter(
        (r) =>
          r.name.includes(q) ||
          r.name.toLowerCase().includes(lower) ||
          (phoneFrag && r.phone?.includes(phoneFrag)) ||
          (email && r.email === email) ||
          (q.includes("@") && r.email?.includes(lower)),
      )
      .map((r) => [r.id, r]),
  );
  return tickets
    .filter((t) => matched.has(t.registrationId))
    .sort((a, b) => a.registrationId.localeCompare(b.registrationId) || (a.kind === "PRIMARY" ? -1 : 1))
    .slice(0, 30)
    .map((t) => {
      const r = matched.get(t.registrationId)!;
      return {
        ticketId: t.id,
        kind: t.kind,
        holderName: t.holderName,
        primaryName: r.name,
        phone: r.phone,
        email: r.email,
        checkedInAt: t.checkedInAt,
        checkInMethod: t.checkInMethod,
        checkedInBy: t.checkedInByName,
      };
    });
}

export async function checkInSummary(eventId: string) {
  const active = col(C.tickets).where("eventId", "==", eventId).where("status", "==", "ACTIVE");
  const [attended, totalTickets] = await Promise.all([count(active.where("checkedIn", "==", true)), count(active)]);
  return { attended, totalTickets };
}

/** آخر من حضر (مع اسم صاحب الدعوة) */
export async function recentCheckIns(eventId: string, take = 6) {
  const tickets = (await getDocs<Ticket>(col(C.tickets).where("eventId", "==", eventId).where("checkedIn", "==", true)))
    .sort(byDate<Ticket>("checkedInAt"))
    .slice(0, take);
  const regs = await Promise.all(tickets.map((t) => getDoc<Registration>(C.registrations, t.registrationId)));
  return tickets.map((t, i) => ({ ...t, primaryName: regs[i]?.name ?? "" }));
}
