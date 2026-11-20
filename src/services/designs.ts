import { z } from "zod";
import { C, col, ref, getDoc, getDocs, newId, runTx, txGet, type Transaction } from "@/lib/firestore";
import { AppError, NotFoundError } from "@/lib/errors";
import { audit, auditTx } from "@/lib/audit";
import type { DesignRequest, Event, Template, User } from "@/lib/types";
import { parseMoney } from "@/lib/format";
import { TEMPLATE_LAYOUTS } from "@/lib/constants";

// ───────── طلبات التصميم الخاص ─────────

const requestSchema = z.object({
  title: z.string().trim().min(3, "اكتب عنوانًا للطلب").max(120),
  details: z.string().trim().min(10, "اشرح التصميم المطلوب (10 أحرف على الأقل)").max(4000),
  referenceUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || /^https?:\/\//i.test(v), "الرابط يجب أن يبدأ بـ http:// أو https://"),
  eventId: z
    .string()
    .optional()
    .transform((v) => v || null),
});

export async function createDesignRequest(ownerId: string, input: z.input<typeof requestSchema>) {
  const r = requestSchema.safeParse(input);
  if (!r.success) throw new AppError(r.error.issues[0]?.message ?? "بيانات غير صالحة");
  if (r.data.eventId) {
    const ev = await getDoc<Event>(C.events, r.data.eventId);
    if (!ev || ev.ownerId !== ownerId) throw new NotFoundError("الفعالية غير موجودة");
  }
  const now = new Date();
  const req: DesignRequest = {
    id: newId(),
    ownerId,
    eventId: r.data.eventId,
    title: r.data.title,
    details: r.data.details,
    referenceUrl: r.data.referenceUrl,
    status: "SUBMITTED",
    quoteAmount: null,
    quoteNotes: null,
    quoteValidUntil: null,
    quotedAt: null,
    acceptedAt: null,
    deliveredTemplateId: null,
    createdAt: now,
    updatedAt: now,
  };
  const { id, ...data } = req;
  await ref(C.designRequests, id).set(data);
  await audit({ actorId: ownerId, action: "design.request", entityType: "DesignRequest", entityId: req.id });
  return req;
}

/** تعليق في سلسلة مراسلات (طلب تصميم أو دعم) — اسم الكاتب ودوره يُحفظان معه */
export async function addComment(authorId: string, target: { designRequestId?: string; supportTicketId?: string }, body: string) {
  const author = await getDoc<User>(C.users, authorId);
  await ref(C.comments, newId()).set({
    authorId,
    authorName: author?.name ?? "",
    authorRole: author?.role ?? "USER",
    designRequestId: target.designRequestId ?? null,
    supportTicketId: target.supportTicketId ?? null,
    body,
    createdAt: new Date(),
  });
}

export async function listComments(target: { designRequestId?: string; supportTicketId?: string }) {
  const q = target.designRequestId
    ? col(C.comments).where("designRequestId", "==", target.designRequestId)
    : col(C.comments).where("supportTicketId", "==", target.supportTicketId!);
  const rows = await getDocs<import("@/lib/types").Comment>(q);
  return rows
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => ({ ...c, author: { id: c.authorId, name: c.authorName, role: c.authorRole } }));
}

async function getRequest(requestId: string, ownerId?: string) {
  const req = await getDoc<DesignRequest>(C.designRequests, requestId);
  if (!req || (ownerId && req.ownerId !== ownerId)) throw new NotFoundError("الطلب غير موجود");
  return req;
}

export async function addDesignComment(userId: string, requestId: string, body: string, asAdmin: boolean) {
  const text = body.trim();
  if (text.length < 1 || text.length > 4000) throw new AppError("اكتب رسالة");
  const req = await getRequest(requestId, asAdmin ? undefined : userId);
  await addComment(userId, { designRequestId: req.id }, text);
}

/** الأدمن يرسل عرض سعر */
export async function quoteDesignRequest(
  adminId: string,
  requestId: string,
  input: { amount: string; notes: string; validDays: string },
) {
  const amount = parseMoney(input.amount);
  if (!amount || amount < 100) throw new AppError("أدخل مبلغًا صحيحًا");
  const days = Math.max(1, Math.min(90, Number(input.validDays) || 14));
  const req = await getRequest(requestId);
  if (!["SUBMITTED", "QUOTED"].includes(req.status)) throw new AppError("لا يمكن تعديل العرض في هذه المرحلة");
  const patch = {
    status: "QUOTED",
    quoteAmount: amount,
    quoteNotes: input.notes.trim().slice(0, 2000) || null,
    quotedAt: new Date(),
    quoteValidUntil: new Date(Date.now() + days * 86400000),
    updatedAt: new Date(),
  };
  await ref(C.designRequests, req.id).update(patch);
  await audit({ actorId: adminId, action: "design.quote", entityType: "DesignRequest", entityId: req.id, meta: { amount } });
  return { ...req, ...patch };
}

export async function rejectDesignRequest(adminId: string, requestId: string, reason: string) {
  const req = await getRequest(requestId);
  if (!["SUBMITTED", "QUOTED"].includes(req.status)) throw new AppError("لا يمكن رفض الطلب في هذه المرحلة");
  await ref(C.designRequests, req.id).update({ status: "REJECTED", updatedAt: new Date() });
  if (reason.trim()) await addComment(adminId, { designRequestId: req.id }, reason.trim());
  await audit({ actorId: adminId, action: "design.reject", entityType: "DesignRequest", entityId: req.id });
}

/** المنظّم يقبل العرض (ثم يدفع) */
export async function acceptDesignQuote(ownerId: string, requestId: string) {
  await transition(requestId, ownerId, (req) => {
    if (req.status !== "QUOTED") throw new AppError("لا يوجد عرض سعر بانتظار القبول");
    if (req.quoteValidUntil && req.quoteValidUntil < new Date()) throw new AppError("انتهت صلاحية العرض. اطلب تحديثه من فريق المنصة.");
    return { status: "ACCEPTED", acceptedAt: new Date() };
  });
  await audit({ actorId: ownerId, action: "design.accept", entityType: "DesignRequest", entityId: requestId });
}

/** انتقال حالة الطلب بمعاملة (يمنع تعارض تعديلين متزامنين) */
async function transition(requestId: string, ownerId: string | undefined, fn: (req: DesignRequest) => Record<string, unknown>, tail?: (tx: Transaction) => void) {
  await runTx(async (tx) => {
    const req = await txGet<DesignRequest>(tx, ref(C.designRequests, requestId));
    if (!req || (ownerId && req.ownerId !== ownerId)) throw new NotFoundError("الطلب غير موجود");
    tx.update(ref(C.designRequests, requestId), { ...fn(req), updatedAt: new Date() });
    tail?.(tx);
  });
}

export async function cancelDesignRequest(ownerId: string, requestId: string) {
  await transition(requestId, ownerId, (req) => {
    if (!["SUBMITTED", "QUOTED", "ACCEPTED"].includes(req.status)) throw new AppError("لا يمكن إلغاء الطلب في هذه المرحلة");
    return { status: "CANCELLED" };
  });
}

export async function setDesignInProgress(adminId: string, requestId: string) {
  await transition(requestId, undefined, (req) => {
    if (req.status !== "PAID") throw new AppError("الطلب يجب أن يكون مدفوعًا");
    return { status: "IN_PROGRESS" };
  });
  await audit({ actorId: adminId, action: "design.in_progress", entityType: "DesignRequest", entityId: requestId });
}

/** تسليم التصميم: يُنشأ قالب خاص بالمنظّم فيظهر له عند اختيار القالب */
export async function deliverDesign(
  adminId: string,
  requestId: string,
  input: { name: string; layout: string; palette: Palette },
) {
  const req = await getRequest(requestId);
  const t = buildTemplate({
    name: input.name,
    layout: input.layout,
    palette: input.palette,
    category: "GENERAL",
    description: `تصميم خاص — ${req.title}`,
    visibility: "PRIVATE",
    ownerId: req.ownerId,
  });
  await transition(
    requestId,
    undefined,
    (cur) => {
      if (!["PAID", "IN_PROGRESS"].includes(cur.status)) throw new AppError("لا يمكن التسليم قبل الدفع");
      return { status: "DELIVERED", deliveredTemplateId: t.id };
    },
    (tx) => {
      const { id, ...data } = t;
      tx.set(ref(C.templates, id), data);
      auditTx(tx, { actorId: adminId, action: "design.deliver", entityType: "DesignRequest", entityId: req.id, meta: { templateId: t.id } });
    },
  );
  return t;
}

// ───────── القوالب ─────────

export type Palette = { primary: string; accent: string; background: string; text: string; muted: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function validatePalette(p: Partial<Palette>): Palette {
  const keys: (keyof Palette)[] = ["primary", "accent", "background", "text", "muted"];
  for (const k of keys) if (!p[k] || !HEX.test(p[k]!)) throw new AppError("الألوان يجب أن تكون بصيغة #RRGGBB");
  return p as Palette;
}

type TemplateInput = {
  name: string;
  layout: string;
  palette: Palette;
  category: string;
  description: string;
  visibility: "PUBLIC" | "PRIVATE";
  ownerId?: string | null;
  sortOrder?: number;
};

function buildTemplate(input: TemplateInput): Template {
  if (!input.name.trim()) throw new AppError("اكتب اسم القالب");
  if (!(TEMPLATE_LAYOUTS as readonly string[]).includes(input.layout)) throw new AppError("التخطيط غير معروف");
  const palette = validatePalette(input.palette);
  const now = new Date();
  return {
    id: newId(),
    name: input.name.trim(),
    layout: input.layout,
    palette: JSON.stringify(palette),
    category: input.category,
    description: input.description,
    status: "ACTIVE",
    visibility: input.visibility,
    ownerId: input.visibility === "PRIVATE" ? (input.ownerId ?? null) : null,
    sortOrder: input.sortOrder ?? 100,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createTemplate(adminId: string, input: TemplateInput) {
  const t = buildTemplate(input);
  const { id, ...data } = t;
  await ref(C.templates, id).set(data);
  await audit({ actorId: adminId, action: "template.create", entityType: "Template", entityId: t.id });
  return t;
}

export async function updateTemplate(
  adminId: string,
  templateId: string,
  input: Partial<Omit<TemplateInput, "palette">> & { palette?: Palette; status?: string },
) {
  const t = await getDoc<Template>(C.templates, templateId);
  if (!t) throw new NotFoundError("القالب غير موجود");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.layout !== undefined) {
    if (!(TEMPLATE_LAYOUTS as readonly string[]).includes(input.layout)) throw new AppError("التخطيط غير معروف");
    data.layout = input.layout;
  }
  if (input.palette) data.palette = JSON.stringify(validatePalette(input.palette));
  if (input.status !== undefined) {
    if (!["ACTIVE", "HIDDEN"].includes(input.status)) throw new AppError("حالة غير صالحة");
    data.status = input.status;
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  data.updatedAt = new Date();
  await ref(C.templates, t.id).update(data);
  await audit({ actorId: adminId, action: "template.update", entityType: "Template", entityId: t.id, meta: Object.keys(data) });
  return { ...t, ...data };
}

export async function templatesForOrganizer(ownerId: string) {
  const [pub, mine] = await Promise.all([
    getDocs<Template>(col(C.templates).where("visibility", "==", "PUBLIC").where("status", "==", "ACTIVE")),
    getDocs<Template>(col(C.templates).where("ownerId", "==", ownerId).where("status", "==", "ACTIVE")),
  ]);
  const sorter = (a: Template, b: Template) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime();
  return [...mine.filter((t) => t.visibility === "PRIVATE").sort(sorter), ...pub.sort(sorter)];
}

export async function listAllTemplates() {
  const all = await getDocs<Template>(col(C.templates));
  return all.sort((a, b) => (a.visibility === b.visibility ? a.sortOrder - b.sortOrder : a.visibility === "PUBLIC" ? -1 : 1));
}

export function parsePalette(json: string): Palette {
  try {
    return JSON.parse(json) as Palette;
  } catch {
    return { primary: "#28182C", accent: "#DDF480", background: "#FBF7EF", text: "#28182C", muted: "#65586B" };
  }
}
