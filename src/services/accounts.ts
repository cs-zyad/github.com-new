import { z } from "zod";
import { C, col, ref, db, getDoc, getDocs, newId, runTx, txGet, uniqueRef } from "@/lib/firestore";
import { AppError, NotFoundError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { sha256 } from "@/lib/ids";
import { audit, auditTx } from "@/lib/audit";
import { emailUniqueKey } from "./staff";
import type { AuthToken, User } from "@/lib/types";

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

export async function findUserByEmail(emailInput: string): Promise<User | null> {
  const email = normalizeEmail(emailInput);
  if (!email) return null;
  const u = await uniqueRef(emailUniqueKey(email)).get();
  if (!u.exists) return null;
  return getDoc<User>(C.users, u.data()!.ref as string);
}

/** إنشاء مستخدم (للتسجيل والبيانات التجريبية) — البريد فريد عبر وثيقة قيد */
export async function createUser(data: { email: string; name: string; phone?: string | null; passwordHash: string | null; role?: string; status?: string }) {
  const email = normalizeEmail(data.email);
  if (!email) throw new AppError("البريد الإلكتروني غير صحيح");
  const id = newId();
  const now = new Date();
  const user: Omit<User, "id"> = {
    email,
    name: data.name,
    phone: data.phone ?? null,
    passwordHash: data.passwordHash,
    role: data.role ?? "USER",
    status: data.status ?? "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  await runTx(async (tx) => {
    const u = await tx.get(uniqueRef(emailUniqueKey(email)));
    if (u.exists) throw new AppError("يوجد حساب بهذا البريد. سجّل الدخول بدلًا من ذلك.");
    tx.set(ref(C.users, id), user);
    tx.set(uniqueRef(emailUniqueKey(email)), { ref: id });
    tx.set(ref(C.wallets, id), { userId: id, balance: 0, createdAt: now, updatedAt: now });
  });
  return { id, ...user } as User;
}

export async function registerOrganizer(input: z.input<typeof registerSchema>) {
  const r = registerSchema.safeParse(input);
  if (!r.success) throw new AppError(r.error.issues[0]?.message ?? "بيانات غير صالحة");
  const email = normalizeEmail(r.data.email);
  if (!email) throw new AppError("البريد الإلكتروني غير صحيح");
  const phone = r.data.phone?.trim() ? normalizePhone(r.data.phone) : null;
  if (r.data.phone?.trim() && !phone) throw new AppError("رقم الجوال غير صحيح");
  const passwordHash = await hashPassword(r.data.password);

  const existing = await findUserByEmail(email);
  if (existing?.status === "INVITED") {
    // حساب أنشئ كدعوة لفريق استقبال — يكمل التسجيل
    const now = new Date();
    await ref(C.users, existing.id).update({ name: r.data.name, phone, passwordHash, status: "ACTIVE", updatedAt: now });
    await ref(C.wallets, existing.id).set({ userId: existing.id, createdAt: now, updatedAt: now }, { merge: true });
    return { ...existing, name: r.data.name, status: "ACTIVE" };
  }
  const user = await createUser({ email, name: r.data.name, phone, passwordHash });
  await audit({ actorId: user.id, action: "user.register", entityType: "User", entityId: user.id });
  return user;
}

export async function authenticate(emailInput: string, password: string) {
  const user = await findUserByEmail(emailInput);
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) throw new AppError("البريد أو كلمة المرور غير صحيحة");
  if (user.status === "SUSPENDED") throw new AppError("الحساب موقوف. تواصل مع دعم المنصة.");
  if (user.status !== "ACTIVE") throw new AppError("أكمل إنشاء كلمة المرور من رابط الدعوة أولًا");
  return user;
}

export async function getSetPasswordToken(token: string) {
  const rec = await getDoc<AuthToken>(C.authTokens, sha256(token));
  if (!rec || rec.usedAt || rec.expiresAt < new Date() || rec.purpose !== "SET_PASSWORD") return null;
  const user = await getDoc<User>(C.users, rec.userId);
  if (!user) return null;
  return { ...rec, user };
}

export async function setPasswordWithToken(token: string, password: string) {
  const p = passwordSchema.safeParse(password);
  if (!p.success) throw new AppError(p.error.issues[0]?.message ?? "كلمة مرور غير صالحة");
  const passwordHash = await hashPassword(password);
  return runTx(async (tx) => {
    const rec = await txGet<AuthToken>(tx, ref(C.authTokens, sha256(token)));
    if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new AppError("الرابط منتهي أو مستخدم مسبقًا");
    const user = await txGet<User>(tx, ref(C.users, rec.userId));
    if (!user) throw new AppError("الحساب غير موجود");
    const wallet = await tx.get(ref(C.wallets, user.id));
    const now = new Date();
    tx.update(ref(C.authTokens, rec.id), { usedAt: now });
    tx.update(ref(C.users, user.id), { passwordHash, status: "ACTIVE", updatedAt: now });
    if (!wallet.exists) tx.set(ref(C.wallets, user.id), { userId: user.id, balance: 0, createdAt: now, updatedAt: now });
    return { ...user, status: "ACTIVE" };
  });
}

// ───────── إدارة الحسابات (الأدمن) ─────────

export async function setUserStatus(adminId: string, userId: string, status: "ACTIVE" | "SUSPENDED") {
  const user = await getDoc<User>(C.users, userId);
  if (!user) throw new NotFoundError("الحساب غير موجود");
  if (user.id === adminId) throw new AppError("لا يمكنك تغيير حالة حسابك");
  if (user.role === "ADMIN") throw new AppError("لا يمكن إيقاف حساب أدمن من هنا");
  await runTx(async (tx) => {
    tx.update(ref(C.users, user.id), { status, updatedAt: new Date() });
    auditTx(tx, { actorId: adminId, action: `user.${status.toLowerCase()}`, entityType: "User", entityId: user.id });
  });
  if (status === "SUSPENDED") {
    const sessions = await col(C.sessions).where("userId", "==", user.id).get();
    const writer = db().bulkWriter();
    sessions.docs.forEach((d) => writer.delete(d.ref));
    await writer.close();
  }
}

export async function listUsers() {
  return getDocs<User>(col(C.users).orderBy("createdAt", "desc").limit(500));
}
