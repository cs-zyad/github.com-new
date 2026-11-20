import { z } from "zod";
import { prisma, withTx, isUniqueViolation } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { sha256 } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { ensureWallet } from "./wallet";

const passwordSchema = z
  .string()
  .min(8, "كلمة المرور 8 أحرف على الأقل")
  .max(128)
  .refine((p) => /[A-Za-z؀-ۿ]/.test(p) && /\d/.test(p), "كلمة المرور يجب أن تحتوي حروفًا وأرقامًا");

const registerSchema = z.object({
  name: z.string().trim().min(2, "اكتب اسمك أو اسم الجهة").max(100),
  email: z.string().trim().min(3, "اكتب البريد الإلكتروني"),
  phone: z.string().optional().default(""),
  password: passwordSchema,
});

export async function registerOrganizer(input: z.input<typeof registerSchema>) {
  const r = registerSchema.safeParse(input);
  if (!r.success) throw new AppError(r.error.issues[0]?.message ?? "بيانات غير صالحة");
  const email = normalizeEmail(r.data.email);
  if (!email) throw new AppError("البريد الإلكتروني غير صحيح");
  const phone = r.data.phone?.trim() ? normalizePhone(r.data.phone) : null;
  if (r.data.phone?.trim() && !phone) throw new AppError("رقم الجوال غير صحيح");
  const passwordHash = await hashPassword(r.data.password);
  try {
    return await withTx(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing?.status === "INVITED") {
        // حساب أنشئ كدعوة لفريق استقبال — يكمل التسجيل
        const u = await tx.user.update({
          where: { id: existing.id },
          data: { name: r.data.name, phone, passwordHash, status: "ACTIVE" },
        });
        await ensureWallet(u.id, tx);
        return u;
      }
      const user = await tx.user.create({ data: { name: r.data.name, email, phone, passwordHash } });
      await ensureWallet(user.id, tx);
      await audit(tx, { actorId: user.id, action: "user.register", entityType: "User", entityId: user.id });
      return user;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("يوجد حساب بهذا البريد. سجّل الدخول بدلًا من ذلك.");
    throw e;
  }
}

export async function authenticate(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) throw new AppError("البريد أو كلمة المرور غير صحيحة");
  if (user.status === "SUSPENDED") throw new AppError("الحساب موقوف. تواصل مع دعم المنصة.");
  if (user.status !== "ACTIVE") throw new AppError("أكمل إنشاء كلمة المرور من رابط الدعوة أولًا");
  return user;
}

export async function getSetPasswordToken(token: string) {
  const rec = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date() || rec.purpose !== "SET_PASSWORD") return null;
  return rec;
}

export async function setPasswordWithToken(token: string, password: string) {
  const p = passwordSchema.safeParse(password);
  if (!p.success) throw new AppError(p.error.issues[0]?.message ?? "كلمة مرور غير صالحة");
  const passwordHash = await hashPassword(password);
  return withTx(async (tx) => {
    const rec = await tx.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new AppError("الرابط منتهي أو مستخدم مسبقًا");
    const used = await tx.authToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new AppError("الرابط مستخدم مسبقًا");
    const user = await tx.user.update({ where: { id: rec.userId }, data: { passwordHash, status: "ACTIVE" } });
    await ensureWallet(user.id, tx);
    return user;
  });
}

// ───────── إدارة الحسابات (الأدمن) ─────────

export async function setUserStatus(adminId: string, userId: string, status: "ACTIVE" | "SUSPENDED") {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("الحساب غير موجود");
  if (user.id === adminId) throw new AppError("لا يمكنك تغيير حالة حسابك");
  if (user.role === "ADMIN") throw new AppError("لا يمكن إيقاف حساب أدمن من هنا");
  await withTx(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status } });
    if (status === "SUSPENDED") await tx.session.deleteMany({ where: { userId: user.id } });
    await audit(tx, { actorId: adminId, action: `user.${status.toLowerCase()}`, entityType: "User", entityId: user.id });
  });
}
