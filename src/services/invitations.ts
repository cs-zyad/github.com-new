import { z } from "zod";
import { C, col, ref, db, getDoc, getDocs, newId, runTx, txGet, uniqueRef, type Transaction } from "@/lib/firestore";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { randomToken } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { getOwnedEvent } from "./events";
import type { InviteChannel } from "@/lib/constants";
import type { Invitation, Registration } from "@/lib/types";

const phoneKey = (eventId: string, phone: string) => `inv-phone:${eventId}:${phone}`;
const emailKey = (eventId: string, email: string) => `inv-email:${eventId}:${email}`;
const DUP_MSG = "يوجد مدعو بنفس رقم الجوال أو البريد في هذه الفعالية";

/** قيود فريدة لرقم الجوال والبريد داخل الفعالية (مرحلة القراءة) */
async function readContactUniques(tx: Transaction, eventId: string, phone: string | null, email: string | null) {
  const [p, e] = await Promise.all([
    phone ? tx.get(uniqueRef(phoneKey(eventId, phone))) : null,
    email ? tx.get(uniqueRef(emailKey(eventId, email))) : null,
  ]);
  return { phoneOwner: (p?.exists ? p.data()?.ref : null) as string | null, emailOwner: (e?.exists ? e.data()?.ref : null) as string | null };
}

function newInvitationDoc(eventId: string, d: { name: string; phone: string | null; email: string | null; channel: InviteChannel; allowCompanion: boolean }) {
  const now = new Date();
  return {
    eventId,
    name: d.name,
    phone: d.phone,
    email: d.email,
    channel: d.channel,
    allowCompanion: d.allowCompanion,
    token: randomToken(),
    deliveryStatus: "NOT_SENT",
    lastSentAt: null,
    regStatus: null,
    registrationId: null,
    createdAt: now,
    updatedAt: now,
  };
}

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
  const id = newId();
  const data = newInvitationDoc(event.id, v.data);
  await runTx(async (tx) => {
    const u = await readContactUniques(tx, event.id, v.data.phone, v.data.email);
    if (u.phoneOwner || u.emailOwner) throw new AppError(DUP_MSG);
    tx.set(ref(C.invitations, id), data);
    if (v.data.phone) tx.set(uniqueRef(phoneKey(event.id, v.data.phone)), { ref: id });
    if (v.data.email) tx.set(uniqueRef(emailKey(event.id, v.data.email)), { ref: id });
  });
  return { id, ...data } as Invitation;
}

async function getOwnedInvitation(ownerId: string, invitationId: string) {
  const inv = await getDoc<Invitation>(C.invitations, invitationId);
  if (!inv) throw new NotFoundError("المدعو غير موجود");
  const event = await getDoc<{ id: string; ownerId: string; mode: string; status: string }>(C.events, inv.eventId);
  if (!event || event.ownerId !== ownerId) throw new NotFoundError("المدعو غير موجود");
  return { inv, event };
}

export async function updateInvitation(ownerId: string, invitationId: string, input: InviteInput) {
  const { inv: found, event } = await getOwnedInvitation(ownerId, invitationId);
  assertPrivateEditable(event);
  const v = validateInvite(input);
  if (!v.ok) throw new AppError(v.error);
  await runTx(async (tx) => {
    const inv = await txGet<Invitation>(tx, ref(C.invitations, found.id));
    if (!inv) throw new NotFoundError("المدعو غير موجود");
    const reg = await txGet<Registration>(tx, ref(C.registrations, `inv_${inv.id}`));
    const u = await readContactUniques(tx, inv.eventId, v.data.phone, v.data.email);
    if ((u.phoneOwner && u.phoneOwner !== inv.id) || (u.emailOwner && u.emailOwner !== inv.id)) {
      throw new AppError("يوجد مدعو آخر بنفس رقم الجوال أو البريد");
    }
    if (reg?.status === "CONFIRMED" && reg.withCompanion && !v.data.allowCompanion) {
      throw new AppError("المدعو أكّد حضوره مع مرافق. ألغِ تسجيله أولًا قبل إلغاء خيار المرافق.");
    }
    if (inv.phone && inv.phone !== v.data.phone) tx.delete(uniqueRef(phoneKey(inv.eventId, inv.phone)));
    if (inv.email && inv.email !== v.data.email) tx.delete(uniqueRef(emailKey(inv.eventId, inv.email)));
    if (v.data.phone) tx.set(uniqueRef(phoneKey(inv.eventId, v.data.phone)), { ref: inv.id });
    if (v.data.email) tx.set(uniqueRef(emailKey(inv.eventId, v.data.email)), { ref: inv.id });
    tx.update(ref(C.invitations, inv.id), { ...v.data, updatedAt: new Date() });
  });
  return { ...found, ...v.data };
}

export async function deleteInvitation(ownerId: string, invitationId: string) {
  const { inv: found } = await getOwnedInvitation(ownerId, invitationId);
  await runTx(async (tx) => {
    const inv = await txGet<Invitation>(tx, ref(C.invitations, found.id));
    if (!inv) return;
    const reg = await txGet<Registration>(tx, ref(C.registrations, `inv_${inv.id}`));
    if (reg && ["CONFIRMED", "WAITLISTED", "OFFERED"].includes(reg.status)) {
      throw new AppError("لا يمكن حذف مدعو لديه تسجيل نشط. ألغِ تسجيله أولًا.");
    }
    if (inv.phone) tx.delete(uniqueRef(phoneKey(inv.eventId, inv.phone)));
    if (inv.email) tx.delete(uniqueRef(emailKey(inv.eventId, inv.email)));
    if (reg) tx.delete(ref(C.registrations, reg.id));
    tx.delete(ref(C.invitations, inv.id));
  });
  await audit({ actorId: ownerId, action: "invitation.delete", entityType: "Invitation", entityId: found.id });
}

/** تطبيق قناة الإرسال على القائمة كاملة مع مراعاة بيانات التواصل المتاحة لكل مدعو */
export async function setChannelForAll(ownerId: string, eventId: string, channel: InviteChannel) {
  const event = await getOwnedEvent(eventId, ownerId);
  assertPrivateEditable(event);
  const invs = await getDocs<Invitation>(col(C.invitations).where("eventId", "==", event.id));
  let adjusted = 0;
  const writer = db().bulkWriter();
  for (const inv of invs) {
    const resolved = resolveChannel(channel, inv.phone, inv.email)!;
    if (resolved !== channel) adjusted++;
    if (resolved !== inv.channel) writer.update(ref(C.invitations, inv.id), { channel: resolved, updatedAt: new Date() });
  }
  await writer.close();
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
  const existing = await getDocs<Invitation>(col(C.invitations).where("eventId", "==", eventId));
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
  let raced = 0;
  // كل صف دفعة ذرّية مستقلة: القيود الفريدة تُنشأ بـ create فتفشل الدفعة إن سبقها إدخال مطابق
  const CONCURRENCY = 20;
  for (let i = 0; i < accepted.length; i += CONCURRENCY) {
    await Promise.all(
      accepted.slice(i, i + CONCURRENCY).map(async (r) => {
        const n = r.normalized!;
        const id = newId();
        const b = db().batch();
        b.set(ref(C.invitations, id), newInvitationDoc(event.id, { ...n, channel: resolveChannel(channel, n.phone, n.email)! }));
        if (n.phone) b.create(uniqueRef(phoneKey(event.id, n.phone)), { ref: id });
        if (n.email) b.create(uniqueRef(emailKey(event.id, n.email)), { ref: id });
        try {
          await b.commit();
          added++;
        } catch (e) {
          if ((e as { code?: number }).code === 6) raced++;
          else throw e;
        }
      }),
    );
  }
  await audit({
    actorId: ownerId,
    action: "invitation.import",
    entityType: "Event",
    entityId: event.id,
    meta: { added, duplicates: preview.duplicates + raced, invalid: preview.invalid },
  });
  return { added, duplicates: preview.duplicates + raced, invalid: preview.invalid };
}
