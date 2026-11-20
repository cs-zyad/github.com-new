import { z } from "zod";
import { C, ref, getDoc, newId } from "@/lib/firestore";
import { AppError, NotFoundError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES } from "@/lib/constants";
import { addComment } from "./designs";
import type { Event, SupportTicket } from "@/lib/types";

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
    const ev = await getDoc<Event>(C.events, r.data.eventId);
    if (!ev || ev.ownerId !== ownerId) throw new NotFoundError("الفعالية غير موجودة");
  }
  const now = new Date();
  const t: SupportTicket = { id: newId(), ownerId, ...r.data, status: "OPEN", createdAt: now, updatedAt: now };
  const { id, ...data } = t;
  await ref(C.supportTickets, id).set(data);
  return t;
}

export async function getSupportTicket(ticketId: string, ownerId?: string) {
  const t = await getDoc<SupportTicket>(C.supportTickets, ticketId);
  if (!t || (ownerId && t.ownerId !== ownerId)) throw new NotFoundError("الطلب غير موجود");
  return t;
}

export async function addSupportComment(userId: string, ticketId: string, body: string, asAdmin: boolean) {
  const text = body.trim();
  if (!text || text.length > 4000) throw new AppError("اكتب رسالة");
  const t = await getSupportTicket(ticketId, asAdmin ? undefined : userId);
  await addComment(userId, { supportTicketId: t.id }, text);
  if (asAdmin && t.status === "OPEN") await ref(C.supportTickets, t.id).update({ status: "IN_PROGRESS", updatedAt: new Date() });
  else if (!asAdmin && (t.status === "RESOLVED" || t.status === "CLOSED")) await ref(C.supportTickets, t.id).update({ status: "OPEN", updatedAt: new Date() });
  else await ref(C.supportTickets, t.id).update({ updatedAt: new Date() });
}

export async function setSupportStatus(adminId: string, ticketId: string, status: string) {
  if (!(SUPPORT_STATUSES as readonly string[]).includes(status)) throw new AppError("حالة غير صالحة");
  const t = await getSupportTicket(ticketId);
  await ref(C.supportTickets, t.id).update({ status, updatedAt: new Date() });
  await audit({ actorId: adminId, action: "support.status", entityType: "SupportTicket", entityId: t.id, meta: { status } });
}
