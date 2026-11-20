import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES } from "@/lib/constants";

const ticketSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES, { message: "اختر نوع الطلب" }),
  subject: z.string().trim().min(3, "اكتب عنوانًا").max(150),
  body: z.string().trim().min(10, "اشرح طلبك (10 أحرف على الأقل)").max(4000),
  eventId: z
    .string()
    .optional()
    .transform((v) => v || null),
});

export async function createSupportTicket(ownerId: string, input: z.input<typeof ticketSchema>) {
  const r = ticketSchema.safeParse(input);
  if (!r.success) throw new AppError(r.error.issues[0]?.message ?? "بيانات غير صالحة");
  if (r.data.eventId) {
    const ev = await prisma.event.findFirst({ where: { id: r.data.eventId, ownerId } });
    if (!ev) throw new NotFoundError("الفعالية غير موجودة");
  }
  return prisma.supportTicket.create({ data: { ...r.data, ownerId } });
}

export async function addSupportComment(userId: string, ticketId: string, body: string, asAdmin: boolean) {
  const text = body.trim();
  if (!text || text.length > 4000) throw new AppError("اكتب رسالة");
  const t = await prisma.supportTicket.findFirst({ where: asAdmin ? { id: ticketId } : { id: ticketId, ownerId: userId } });
  if (!t) throw new NotFoundError("الطلب غير موجود");
  await prisma.comment.create({ data: { authorId: userId, supportTicketId: t.id, body: text } });
  if (asAdmin && t.status === "OPEN") {
    await prisma.supportTicket.update({ where: { id: t.id }, data: { status: "IN_PROGRESS" } });
  }
  if (!asAdmin && (t.status === "RESOLVED" || t.status === "CLOSED")) {
    await prisma.supportTicket.update({ where: { id: t.id }, data: { status: "OPEN" } });
  }
}

export async function setSupportStatus(adminId: string, ticketId: string, status: string) {
  if (!(SUPPORT_STATUSES as readonly string[]).includes(status)) throw new AppError("حالة غير صالحة");
  const t = await prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
  await audit(prisma, { actorId: adminId, action: "support.status", entityType: "SupportTicket", entityId: t.id, meta: { status } });
}
