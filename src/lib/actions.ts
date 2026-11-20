import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { errorMessage } from "./errors";

function withParam(url: string, key: string, value?: string | null) {
  if (!value) return url;
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.delete("ok");
  params.delete("error");
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

/**
 * غلاف الإجراءات: ينفذ العملية ثم يعيد التوجيه برسالة نجاح أو خطأ واضحة.
 * redirect خارج try حتى لا يُبتلع.
 */
export async function act(
  back: string,
  fn: () => Promise<string | { ok?: string; to?: string } | void>,
): Promise<never> {
  let target: string;
  try {
    const r = await fn();
    const ok = typeof r === "string" ? r : (r?.ok ?? null);
    const to = typeof r === "object" && r?.to ? r.to : back;
    target = withParam(to, "ok", ok);
    if (to.startsWith("/")) revalidatePath(to.split("?")[0]);
  } catch (e) {
    target = withParam(back, "error", errorMessage(e));
  }
  redirect(target);
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export type FormState = { error?: string; ok?: string; values?: Record<string, string> };

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string" && !k.startsWith("$") && k !== "password") out[k] = v;
  });
  return out;
}
