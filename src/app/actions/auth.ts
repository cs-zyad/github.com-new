"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth";
import { authenticate, registerOrganizer, setPasswordWithToken } from "@/services/accounts";
import { errorMessage } from "@/lib/errors";
import { str, formValues, type FormState } from "@/lib/actions";
import { rateLimit } from "@/lib/rateLimit";
import { headers } from "next/headers";

async function clientKey(prefix: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  return `${prefix}:${ip}`;
}

function safeNext(next: string, fallback: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  let target = "/dashboard";
  try {
    if (!rateLimit(await clientKey("login"), 10, 60_000)) throw new Error("RATE");
    const user = await authenticate(str(fd, "email"), str(fd, "password"));
    await createSession(user.id);
    target = safeNext(str(fd, "next"), user.role === "ADMIN" ? "/admin" : "/dashboard");
  } catch (e) {
    const msg = e instanceof Error && e.message === "RATE" ? "محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى." : errorMessage(e);
    return { error: msg, values: formValues(fd) };
  }
  redirect(target);
}

export async function registerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    if (!rateLimit(await clientKey("register"), 5, 60_000)) throw new Error("RATE");
    const user = await registerOrganizer({
      name: str(fd, "name"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      password: str(fd, "password"),
    });
    await createSession(user.id);
  } catch (e) {
    const msg = e instanceof Error && e.message === "RATE" ? "محاولات كثيرة. انتظر دقيقة." : errorMessage(e);
    return { error: msg, values: formValues(fd) };
  }
  redirect("/dashboard?ok=" + encodeURIComponent("تم إنشاء حسابك. ابدأ بإنشاء أول فعالية."));
}

export async function setPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  let dest = "/checkin";
  try {
    if (str(fd, "password") !== str(fd, "password2")) return { error: "كلمتا المرور غير متطابقتين" };
    const user = await setPasswordWithToken(str(fd, "token"), str(fd, "password"));
    await createSession(user.id);
    const { C, col, count } = await import("@/lib/firestore");
    const owns = await count(col(C.events).where("ownerId", "==", user.id));
    dest = owns > 0 ? "/dashboard" : "/checkin";
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(dest);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
