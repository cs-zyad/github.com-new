import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { C, ref, getDoc } from "./firestore";
import type { Session, User } from "./types";
import { randomToken, sha256 } from "./ids";
import { env } from "./env";
import { ForbiddenError } from "./errors";

export const SESSION_COOKIE = "wafda_session";
const SESSION_DAYS = 30;

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

export async function createSession(userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await ref(C.sessions, sha256(token)).set({ userId, expiresAt, createdAt: new Date() });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await ref(C.sessions, sha256(token)).delete();
  }
  jar.delete(SESSION_COOKIE);
}

/** المستخدم الحالي (مرة واحدة لكل طلب) */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await getDoc<Session>(C.sessions, sha256(token));
  if (!session || session.expiresAt < new Date()) return null;
  const user = await getDoc<User>(C.users, session.userId);
  if (!user || user.status !== "ACTIVE") return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status };
});

/** للصفحات: يحوّل لتسجيل الدخول إذا لم يكن هناك مستخدم */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/dashboard");
  return user;
}

/** للإجراءات والـ API: يرمي خطأ بدل التحويل */
export async function assertUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("انتهت الجلسة. سجّل الدخول مرة أخرى.");
  return user;
}

export async function assertAdmin(): Promise<CurrentUser> {
  const user = await assertUser();
  if (user.role !== "ADMIN") throw new ForbiddenError();
  return user;
}
