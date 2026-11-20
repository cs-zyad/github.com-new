import { z } from "zod";
import { prisma, withTx } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/contact";
import { randomToken, sha256 } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { getOwnedEvent } from "./events";
import { composeStaffInvite } from "./compose";
import { enqueueSystemMessage, kickOutbox } from "./messaging";

const staffSchema = z.object({
  name: z.string().trim().min(2, "اكتب اسم عضو الفريق").max(80),
  email: z.string().trim().min(3, "اكتب البريد الإلكتروني"),
});

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

  const result = await withTx(async (tx) => {
    let user = await tx.user.findUnique({ where: { email } });
    let setPasswordToken: string | null = null;
    if (user?.role === "ADMIN") throw new AppError("لا يمكن إضافة حساب أدمن المنصة لفريق الاستقبال");
    if (user?.id === ownerId) throw new AppError("أنت مالك الفعالية ولديك صلاحية التحضير تلقائيًا");
    if (!user) {
      user = await tx.user.create({ data: { email, name: parsed.data.name, status: "INVITED" } });
    }
    if (user.status === "INVITED") {
      setPasswordToken = randomToken(24);
      await tx.authToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(setPasswordToken),
          purpose: "SET_PASSWORD",
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
    }
    const exists = await tx.eventStaff.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } });
    if (exists) throw new AppError("هذا العضو مضاف مسبقًا لفريق الاستقبال");
    await tx.eventStaff.create({ data: { eventId: event.id, userId: user.id, addedById: ownerId } });

    const msg = composeStaffInvite(event, { name: user.name }, setPasswordToken);
    await enqueueSystemMessage(tx, {
      ownerId,
      eventId: event.id,
      kind: "STAFF_INVITE",
      channel: "EMAIL",
      recipient: email,
      subject: msg.subject,
      body: msg.body,
      idempotencyKey: `staff:${event.id}:${user.id}:${Date.now()}`,
    });
    await audit(tx, {
      actorId: ownerId,
      action: "staff.add",
      entityType: "Event",
      entityId: event.id,
      meta: { staffUserId: user.id, email },
    });
    return { userId: user.id, setPasswordToken };
  });
  await kickOutbox();
  return result;
}

export async function removeStaff(ownerId: string, eventId: string, staffUserId: string) {
  const event = await getOwnedEvent(eventId, ownerId);
  const res = await prisma.eventStaff.deleteMany({ where: { eventId: event.id, userId: staffUserId } });
  if (res.count === 0) throw new NotFoundError("العضو غير موجود في فريق هذه الفعالية");
  await audit(prisma, { actorId: ownerId, action: "staff.remove", entityType: "Event", entityId: event.id, meta: { staffUserId } });
}

export async function listStaff(eventId: string) {
  return prisma.eventStaff.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true, email: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** الفعاليات التي يستطيع المستخدم العمل على استقبالها */
export async function checkInEventsFor(userId: string) {
  return prisma.event.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ ownerId: userId }, { staff: { some: { userId } } }],
    },
    orderBy: { startsAt: "asc" },
  });
}
