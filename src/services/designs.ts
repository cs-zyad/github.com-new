import { z } from "zod";
import { prisma, withTx } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { audit } from "@/lib/audit";
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
    const ev = await prisma.event.findFirst({ where: { id: r.data.eventId, ownerId } });
    if (!ev) throw new NotFoundError("الفعالية غير موجودة");
  }
  const req = await prisma.designRequest.create({ data: { ...r.data, ownerId } });
  await audit(prisma, { actorId: ownerId, action: "design.request", entityType: "DesignRequest", entityId: req.id });
  return req;
}

export async function addDesignComment(userId: string, requestId: string, body: string, asAdmin: boolean) {
  const text = body.trim();
  if (text.length < 1 || text.length > 4000) throw new AppError("اكتب رسالة");
  const req = await prisma.designRequest.findFirst({ where: asAdmin ? { id: requestId } : { id: requestId, ownerId: userId } });
  if (!req) throw new NotFoundError("الطلب غير موجود");
  return prisma.comment.create({ data: { authorId: userId, designRequestId: req.id, body: text } });
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
  const req = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("الطلب غير موجود");
  if (!["SUBMITTED", "QUOTED"].includes(req.status)) throw new AppError("لا يمكن تعديل العرض في هذه المرحلة");
  const updated = await prisma.designRequest.update({
    where: { id: req.id },
    data: {
      status: "QUOTED",
      quoteAmount: amount,
      quoteNotes: input.notes.trim().slice(0, 2000) || null,
      quotedAt: new Date(),
      quoteValidUntil: new Date(Date.now() + days * 86400000),
    },
  });
  await audit(prisma, { actorId: adminId, action: "design.quote", entityType: "DesignRequest", entityId: req.id, meta: { amount } });
  return updated;
}

export async function rejectDesignRequest(adminId: string, requestId: string, reason: string) {
  const req = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("الطلب غير موجود");
  if (!["SUBMITTED", "QUOTED"].includes(req.status)) throw new AppError("لا يمكن رفض الطلب في هذه المرحلة");
  await withTx(async (tx) => {
    await tx.designRequest.update({ where: { id: req.id }, data: { status: "REJECTED" } });
    if (reason.trim()) await tx.comment.create({ data: { authorId: adminId, designRequestId: req.id, body: reason.trim() } });
    await audit(tx, { actorId: adminId, action: "design.reject", entityType: "DesignRequest", entityId: req.id });
  });
}

/** المنظّم يقبل العرض (ثم يدفع) */
export async function acceptDesignQuote(ownerId: string, requestId: string) {
  const req = await prisma.designRequest.findFirst({ where: { id: requestId, ownerId } });
  if (!req) throw new NotFoundError("الطلب غير موجود");
  if (req.status !== "QUOTED") throw new AppError("لا يوجد عرض سعر بانتظار القبول");
  if (req.quoteValidUntil && req.quoteValidUntil < new Date()) throw new AppError("انتهت صلاحية العرض. اطلب تحديثه من فريق المنصة.");
  const res = await prisma.designRequest.updateMany({
    where: { id: req.id, status: "QUOTED" },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
  if (res.count !== 1) throw new AppError("تغيّرت حالة الطلب. حدّث الصفحة.");
  await audit(prisma, { actorId: ownerId, action: "design.accept", entityType: "DesignRequest", entityId: req.id });
}

export async function cancelDesignRequest(ownerId: string, requestId: string) {
  const res = await prisma.designRequest.updateMany({
    where: { id: requestId, ownerId, status: { in: ["SUBMITTED", "QUOTED", "ACCEPTED"] } },
    data: { status: "CANCELLED" },
  });
  if (res.count !== 1) throw new AppError("لا يمكن إلغاء الطلب في هذه المرحلة");
}

export async function setDesignInProgress(adminId: string, requestId: string) {
  const res = await prisma.designRequest.updateMany({ where: { id: requestId, status: "PAID" }, data: { status: "IN_PROGRESS" } });
  if (res.count !== 1) throw new AppError("الطلب يجب أن يكون مدفوعًا");
  await audit(prisma, { actorId: adminId, action: "design.in_progress", entityType: "DesignRequest", entityId: requestId });
}

/** تسليم التصميم: يُنشأ قالب خاص بالمنظّم فيظهر له عند اختيار القالب */
export async function deliverDesign(
  adminId: string,
  requestId: string,
  input: { name: string; layout: string; palette: Palette },
) {
  const req = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("الطلب غير موجود");
  if (!["PAID", "IN_PROGRESS"].includes(req.status)) throw new AppError("لا يمكن التسليم قبل الدفع");
  const tpl = await withTx(async (tx) => {
    const t = await createTemplateRecord(tx, {
      name: input.name,
      layout: input.layout,
      palette: input.palette,
      category: "GENERAL",
      description: `تصميم خاص — ${req.title}`,
      visibility: "PRIVATE",
      ownerId: req.ownerId,
    });
    await tx.designRequest.update({ where: { id: req.id }, data: { status: "DELIVERED", deliveredTemplateId: t.id } });
    await audit(tx, { actorId: adminId, action: "design.deliver", entityType: "DesignRequest", entityId: req.id, meta: { templateId: t.id } });
    return t;
  });
  return tpl;
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

async function createTemplateRecord(db: typeof prisma | Parameters<Parameters<typeof withTx>[0]>[0], input: TemplateInput) {
  if (!input.name.trim()) throw new AppError("اكتب اسم القالب");
  if (!(TEMPLATE_LAYOUTS as readonly string[]).includes(input.layout)) throw new AppError("التخطيط غير معروف");
  const palette = validatePalette(input.palette);
  return db.template.create({
    data: {
      name: input.name.trim(),
      layout: input.layout,
      palette: JSON.stringify(palette),
      category: input.category,
      description: input.description,
      visibility: input.visibility,
      ownerId: input.visibility === "PRIVATE" ? input.ownerId : null,
      sortOrder: input.sortOrder ?? 100,
    },
  });
}

export async function createTemplate(adminId: string, input: TemplateInput) {
  const t = await createTemplateRecord(prisma, input);
  await audit(prisma, { actorId: adminId, action: "template.create", entityType: "Template", entityId: t.id });
  return t;
}

export async function updateTemplate(
  adminId: string,
  templateId: string,
  input: Partial<Omit<TemplateInput, "palette">> & { palette?: Palette; status?: string },
) {
  const t = await prisma.template.findUnique({ where: { id: templateId } });
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
  const updated = await prisma.template.update({ where: { id: t.id }, data });
  await audit(prisma, { actorId: adminId, action: "template.update", entityType: "Template", entityId: t.id, meta: Object.keys(data) });
  return updated;
}

export async function templatesForOrganizer(ownerId: string) {
  return prisma.template.findMany({
    where: { status: "ACTIVE", OR: [{ visibility: "PUBLIC" }, { visibility: "PRIVATE", ownerId }] },
    orderBy: [{ visibility: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export function parsePalette(json: string): Palette {
  try {
    return JSON.parse(json) as Palette;
  } catch {
    return { primary: "#28182C", accent: "#DDF480", background: "#FBF7EF", text: "#28182C", muted: "#65586B" };
  }
}
