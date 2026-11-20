import { z } from "zod";
import { prisma, withTx, isUniqueViolation } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { randomToken } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { getOwnedEvent } from "./events";
import type { InviteChannel } from "@/lib/constants";

/** القناة الفعلية حسب بيانات التواصل المتاحة */
export function resolveChannel(preferred: InviteChannel, phone: string | null, email: string | null): InviteChannel | null {
  if (!phone && !email) return null;
  if (preferred === "BOTH") return phone && email ? "BOTH" : phone ? "WHATSAPP" : "EMAIL";
  if (preferred === "WHATSAPP") return phone ? "WHATSAPP" : "EMAIL";
  return email ? "EMAIL" : "WHATSAPP";
}

export function channelsOf(inv: { channel: string; phone: string | null; email: string | null }) {
  const out: { channel: "WHATSAPP" | "EMAIL"; recipient: string }[] = [];
  if ((inv.channel === "WHATSAPP" || inv.channel === "BOTH") && inv.phone) out.push({ channel: "WHATSAPP", recipient: inv.phone });
  if ((inv.channel === "EMAIL" || inv.channel === "BOTH") && inv.email) out.push({ channel: "EMAIL", recipient: inv.email });
  return out;
}

const inviteSchema = z.object({
  name: z.string().trim().min(2, "اكتب اسم المدعو").max(80, "الاسم طويل"),
  phone: z.string().optional().default(""),
  email: z.string().optional().default(""),
  channel: z.enum(["WHATSAPP", "EMAIL", "BOTH"]).default("WHATSAPP"),
  allowCompanion: z.boolean().default(false),
});

export type InviteInput = z.input<typeof inviteSchema>;

export function validateInvite(input: InviteInput) {
  const r = inviteSchema.safeParse(input);
  if (!r.success) return { ok: false as const, error: r.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const d = r.data;
  const phone = d.phone?.trim() ? normalizePhone(d.phone) : null;
  const email = d.email?.trim() ? normalizeEmail(d.email) : null;
  if (d.phone?.trim() && !phone) return { ok: false as const, error: "رقم الجوال غير صحيح" };
  if (d.email?.trim() && !email) return { ok: false as const, error: "البريد الإلكتروني غير صحيح" };
  const channel = resolveChannel(d.channel, phone, email);
  if (!channel) return { ok: false as const, error: "أضف رقم جوال أو بريدًا إلكترونيًا" };
  return { ok: true as const, data: { name: d.name, phone, email, channel, allowCompanion: d.allowCompanion } };
}

function assertPrivateEditable(event: { mode: string; status: string }) {
  if (event.mode !== "PRIVATE") throw new AppError("إدارة المدعوين متاحة للفعاليات ذات الدعوات الخاصة");
  if (event.status === "CANCELLED" || event.status === "ENDED") throw new AppError("الفعالية منتهية أو ملغاة");
}

export async function addInvitation(ownerId: string, eventId: string, input: InviteInput) {
  const event = await getOwnedEvent(eventId, ownerId);
  assertPrivateEditable(event);
  const v = validateInvite(input);
  if (!v.ok) throw new AppError(v.error);
  try {
    return await prisma.invitation.create({ data: { ...v.data, eventId: event.id, token: randomToken() } });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("يوجد مدعو بنفس رقم الجوال أو البريد في هذه الفعالية");
    throw e;
  }
}

export async function updateInvitation(ownerId: string, invitationId: string, input: InviteInput) {
  const inv = await prisma.invitation.findFirst({
    where: { id: invitationId, event: { ownerId } },
    include: { registration: true, event: true },
  });
  if (!inv) throw new NotFoundError("المدعو غير موجود");
  assertPrivateEditable(inv.event);
  const v = validateInvite(input);
  if (!v.ok) throw new AppError(v.error);
  if (inv.registration?.status === "CONFIRMED" && inv.registration.withCompanion && !v.data.allowCompanion) {
    throw new AppError("المدعو أكّد حضوره مع مرافق. ألغِ تسجيله أولًا قبل إلغاء خيار المرافق.");
  }
  try {
    return await prisma.invitation.update({ where: { id: inv.id }, data: v.data });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("يوجد مدعو آخر بنفس رقم الجوال أو البريد");
    throw e;
  }
}

export async function deleteInvitation(ownerId: string, invitationId: string) {
  const inv = await prisma.invitation.findFirst({
    where: { id: invitationId, event: { ownerId } },
    include: { registration: true },
  });
  if (!inv) throw new NotFoundError("المدعو غير موجود");
  if (inv.registration && ["CONFIRMED", "WAITLISTED", "OFFERED"].includes(inv.registration.status)) {
    throw new AppError("لا يمكن حذف مدعو لديه تسجيل نشط. ألغِ تسجيله أولًا.");
  }
  await prisma.invitation.delete({ where: { id: inv.id } });
  await audit(prisma, { actorId: ownerId, action: "invitation.delete", entityType: "Invitation", entityId: inv.id });
}

/** تطبيق قناة الإرسال على القائمة كاملة مع مراعاة بيانات التواصل المتاحة لكل مدعو */
export async function setChannelForAll(ownerId: string, eventId: string, channel: InviteChannel) {
  const event = await getOwnedEvent(eventId, ownerId);
  assertPrivateEditable(event);
  const invs = await prisma.invitation.findMany({ where: { eventId: event.id } });
  let adjusted = 0;
  await withTx(async (tx) => {
    for (const inv of invs) {
      const resolved = resolveChannel(channel, inv.phone, inv.email)!;
      if (resolved !== channel) adjusted++;
      if (resolved !== inv.channel) await tx.invitation.update({ where: { id: inv.id }, data: { channel: resolved } });
    }
  });
  return { total: invs.length, adjusted };
}

// ───────── الاستيراد ─────────

export type ImportRow = {
  row: number;
  name: string;
  phone: string;
  email: string;
  companion: string;
};

export type ImportPreviewRow = ImportRow & {
  status: "ACCEPTED" | "DUPLICATE" | "INVALID";
  reason?: string;
  normalized?: { name: string; phone: string | null; email: string | null; allowCompanion: boolean };
};

const YES = ["نعم", "yes", "y", "1", "true", "مرافق", "✓", "x"];

export function parseCompanion(v: string): boolean {
  return YES.includes(String(v ?? "").trim().toLowerCase());
}

/**
 * تصنيف صفوف الاستيراد: مقبول / مكرر (داخل الملف أو مع المدعوين الحاليين) / يحتاج تصحيحًا.
 */
export async function classifyImportRows(eventId: string, rows: ImportRow[], defaultChannel: InviteChannel = "WHATSAPP") {
  const existing = await prisma.invitation.findMany({ where: { eventId }, select: { phone: true, email: true } });
  const seenPhones = new Set(existing.map((e) => e.phone).filter(Boolean) as string[]);
  const seenEmails = new Set(existing.map((e) => e.email).filter(Boolean) as string[]);
  const filePhones = new Map<string, number>();
  const fileEmails = new Map<string, number>();

  const out: ImportPreviewRow[] = [];
  for (const r of rows) {
    const v = validateInvite({
      name: r.name,
      phone: r.phone,
      email: r.email,
      channel: defaultChannel,
      allowCompanion: parseCompanion(r.companion),
    });
    if (!v.ok) {
      out.push({ ...r, status: "INVALID", reason: v.error });
      continue;
    }
    const { phone, email } = v.data;
    if ((phone && seenPhones.has(phone)) || (email && seenEmails.has(email))) {
      out.push({ ...r, status: "DUPLICATE", reason: "موجود مسبقًا في قائمة المدعوين" });
      continue;
    }
    const dupRow = (phone && filePhones.get(phone)) || (email && fileEmails.get(email));
    if (dupRow) {
      out.push({ ...r, status: "DUPLICATE", reason: `مكرر مع الصف ${dupRow} في الملف` });
      continue;
    }
    if (phone) filePhones.set(phone, r.row);
    if (email) fileEmails.set(email, r.row);
    out.push({
      ...r,
      status: "ACCEPTED",
      normalized: { name: v.data.name, phone, email, allowCompanion: v.data.allowCompanion },
    });
  }
  return {
    rows: out,
    accepted: out.filter((r) => r.status === "ACCEPTED").length,
    duplicates: out.filter((r) => r.status === "DUPLICATE").length,
    invalid: out.filter((r) => r.status === "INVALID").length,
  };
}

/** اعتماد الاستيراد: يعيد التحقق في الخادم ولا يضيف إلا الصفوف المقبولة */
export async function commitImport(ownerId: string, eventId: string, rows: ImportRow[], channel: InviteChannel) {
  const event = await getOwnedEvent(eventId, ownerId);
  assertPrivateEditable(event);
  if (rows.length > 5000) throw new AppError("الحد الأقصى 5000 صف في المرة الواحدة");
  const preview = await classifyImportRows(event.id, rows, channel);
  const accepted = preview.rows.filter((r) => r.status === "ACCEPTED");
  let added = 0;
  await withTx(async (tx) => {
    for (const r of accepted) {
      const n = r.normalized!;
      await tx.invitation.create({
        data: {
          eventId: event.id,
          name: n.name,
          phone: n.phone,
          email: n.email,
          allowCompanion: n.allowCompanion,
          channel: resolveChannel(channel, n.phone, n.email)!,
          token: randomToken(),
        },
      });
      added++;
    }
  });
  await audit(prisma, {
    actorId: ownerId,
    action: "invitation.import",
    entityType: "Event",
    entityId: event.id,
    meta: { added, duplicates: preview.duplicates, invalid: preview.invalid },
  });
  return { added, duplicates: preview.duplicates, invalid: preview.invalid };
}
