import { randomBytes, createHash } from "node:crypto";

/** معرّف عشوائي آمن (افتراضيًا 128 بت) بترميز base64url */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

/** رمز تذكرة عشوائي — 160 بت، بدون أي بيانات شخصية */
export function ticketCode(): string {
  return "W1" + randomBytes(20).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** مرجع قصير للعرض فقط (ليس للمصادقة) */
export function shortRef(code: string): string {
  return sha256(code).slice(0, 6).toUpperCase();
}
