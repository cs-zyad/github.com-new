import { z } from "zod";
import { C, col, ref, getDoc, getDocs, getMany, newId, runTx, txGet, uniqueRef } from "@/lib/firestore";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/contact";
import { randomToken, sha256 } from "@/lib/ids";
import { audit, auditTx } from "@/lib/audit";
import { getOwnedEvent, staffDocId } from "./events";
import { composeStaffInvite } from "./compose";
import { writeSystemMessage, kickOutbox } from "./messaging";
import type { Event, EventStaff, User } from "@/lib/types";

const staffSchema = z.object({
  name: z.string().trim().min(2, "اكتب اسم عضو الفريق").max(80),
  email: z.string().trim().min(3, "اكتب البريد الإلكتروني"),
});

export const emailUniqueKey = (email: string) => `user-email:${email}`;

/**
 * إضافة عضو لفريق الاستقبال لفعالية محددة.
 * إن لم يكن لديه حساب يُنشأ حساب بحالة INVITED ويستلم رابط إنشاء كلمة المرور.
 */
export async function addStaff(ownerId: string, eventId: string, input: { name: string; email: string }) {
  const event = await getOwnedEvent(eventId, ownerId);
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "بيانات غير صالحة");
  const email = normalizeEmail(parsed.data.email);
  if (!email) throw new AppError("البريد الإلكتروني غير صحيح");

  const result = await runTx(async (tx) => {
    const uniq = await tx.get(uniqueRef(emailUniqueKey(email)));
    const existingId = uniq.exists ? (uniq.data()!.ref as string) : null;
    const existing = existingId ? await txGet<User>(tx, ref(C.users, existingId)) : null;
    const userId = existing?.id ?? newId();
    const assignment = await tx.get(ref(C.eventStaff, staffDocId(event.id, userId)));

    if (existing?.role === "ADMIN") throw new AppError("لا يمكن إضافة حساب أدمن المنصة لفريق الاستقبال");
    if (userId === ownerId) throw new AppError("أنت مالك الفعالية ولديك صلاحية التحضير تلقائيًا");
    if (assignment.exists) throw new AppError("هذا العضو مضاف مسبقًا لفريق الاستقبال");

    const now = new Date();
    const name = existing?.name ?? parsed.data.name;
    if (!existing) {
      tx.set(ref(C.users, userId), { email, name, phone: null, passwordHash: null, role: "USER", status: "INVITED", createdAt: now, updatedAt: now });
      tx.set(uniqueRef(emailUniqueKey(email)), { ref: userId });
    }
    let setPasswordToken: string | null = null;
    if (!existing || existing.status === "INVITED") {
      setPasswordToken = randomToken(24);
      tx.set(ref(C.authTokens, sha256(setPasswordToken)), {
        userId,
        purpose: "SET_PASSWORD",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        usedAt: null,
        createdAt: now,
      });
    }
    tx.set(ref(C.eventStaff, staffDocId(event.id, userId)), { eventId: event.id, userId, addedById: ownerId, createdAt: now });
    const msg = composeStaffInvite(event, { name }, setPasswordToken);
    writeSystemMessage(tx, {
      ownerId,
      eventId: event.id,
      kind: "STAFF_INVITE",
      channel: "EMAIL",
      recipient: email,
      subject: msg.subject,
      body: msg.body,
      idempotencyKey: `staff:${event.id}:${userId}:${now.getTime()}`,
    });
    auditTx(tx, { actorId: ownerId, action: "staff.add", entityType: "Event", entityId: event.id, meta: { staffUserId: userId, email } });
    return { userId, setPasswordToken };
  });
  await kickOutbox();
  return result;
}

export async function removeStaff(ownerId: string, eventId: string, staffUserId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  const r = ref(C.eventStaff, staffDocId(event.id, staffUserId));
  if (!(await r.get()).exists) throw new NotFoundError("العضو غير موجود في فريق هذه الفعالية");
  await r.delete();
  await audit({ actorId: ownerId, action: "staff.remove", entityType: "Event", entityId: event.id, meta: { staffUserId } });
}

export async function listStaff(eventId: string) {
  const rows = await getDocs<EventStaff>(col(C.eventStaff).where("eventId", "==", eventId));
  const users = await getMany<User>(C.users, rows.map((r) => r.userId));
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows
    .filter((r) => byId.has(r.userId))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => {
      const u = byId.get(r.userId)!;
      return { ...r, user: { id: u.id, name: u.name, email: u.email, status: u.status } };
    });
}

/** الفعاليات النشطة التي يستطيع المستخدم العمل على استقبالها */
export async function checkInEventsFor(userId: string) {
  const [owned, assignments] = await Promise.all([
    getDocs<Event>(col(C.events).where("ownerId", "==", userId).where("status", "==", "ACTIVE")),
    getDocs<EventStaff>(col(C.eventStaff).where("userId", "==", userId)),
  ]);
  const assigned = (await getMany<Event>(C.events, assignments.map((a) => a.eventId))).filter((e) => e.status === "ACTIVE");
  const all = new Map([...owned, ...assigned].map((e) => [e.id, e]));
  return [...all.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function getUser(id: string) {
  return getDoc<User>(C.users, id);
}
