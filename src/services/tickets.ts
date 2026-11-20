import QRCode from "qrcode";
import { C, ref, txGet, type Transaction } from "@/lib/firestore";
import { ticketCode } from "@/lib/ids";
import type { Ticket } from "@/lib/types";

export const COMPANION_LABEL = "مرافق";

/** رمز QR كـ SVG من رمز التذكرة (محتوى الرمز هو المعرّف العشوائي فقط) */
export async function qrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#28182C", light: "#FFFFFF" } });
}

export const ticketId = (registrationId: string, kind: "PRIMARY" | "COMPANION") => `${registrationId}_${kind}`;

/** قراءة تذاكر التسجيل داخل المعاملة (مرحلة القراءة) */
export async function readTickets(tx: Transaction, registrationId: string) {
  const [primary, companion] = await Promise.all([
    txGet<Ticket>(tx, ref(C.tickets, ticketId(registrationId, "PRIMARY"))),
    txGet<Ticket>(tx, ref(C.tickets, ticketId(registrationId, "COMPANION"))),
  ]);
  return { primary, companion };
}

/**
 * إصدار/تفعيل التذاكر (مرحلة الكتابة). التذكرة فريدة لكل (تسجيل، نوع) بمعرّف ثابت،
 * فتكرار التأكيد لا يصدر تذاكر إضافية. عند إعادة التفعيل بعد إلغاء يتغير الرمز.
 * يعيد التذاكر النشطة بعد الكتابة.
 */
export function writeTickets(
  tx: Transaction,
  existing: { primary: Ticket | null; companion: Ticket | null },
  params: { eventId: string; registrationId: string; holderName: string; withCompanion: boolean },
): { kind: string; code: string }[] {
  const now = new Date();
  const out: { kind: string; code: string }[] = [];
  const kinds: ("PRIMARY" | "COMPANION")[] = params.withCompanion ? ["PRIMARY", "COMPANION"] : ["PRIMARY"];
  for (const kind of kinds) {
    const cur = kind === "PRIMARY" ? existing.primary : existing.companion;
    const holderName = kind === "PRIMARY" ? params.holderName : COMPANION_LABEL;
    const r = ref(C.tickets, ticketId(params.registrationId, kind));
    if (!cur) {
      const code = ticketCode();
      tx.set(r, {
        eventId: params.eventId,
        registrationId: params.registrationId,
        kind,
        holderName,
        code,
        status: "ACTIVE",
        checkedIn: false,
        checkedInAt: null,
        checkedInById: null,
        checkedInByName: null,
        checkInMethod: null,
        createdAt: now,
        updatedAt: now,
      });
      out.push({ kind, code });
    } else if (cur.status !== "ACTIVE") {
      const code = ticketCode();
      tx.update(r, { status: "ACTIVE", holderName, code, updatedAt: now });
      out.push({ kind, code });
    } else {
      if (cur.holderName !== holderName) tx.update(r, { holderName, updatedAt: now });
      out.push({ kind, code: cur.code });
    }
  }
  if (!params.withCompanion && existing.companion && existing.companion.status === "ACTIVE" && !existing.companion.checkedIn) {
    tx.update(ref(C.tickets, existing.companion.id), { status: "CANCELLED", updatedAt: now });
  }
  return out;
}

export function cancelTicketsWrite(tx: Transaction, existing: { primary: Ticket | null; companion: Ticket | null }) {
  for (const t of [existing.primary, existing.companion]) {
    if (t && t.status === "ACTIVE") tx.update(ref(C.tickets, t.id), { status: "CANCELLED", updatedAt: new Date() });
  }
}
