import QRCode from "qrcode";
import type { Tx } from "@/lib/db";
import { ticketCode } from "@/lib/ids";

export const COMPANION_LABEL = "مرافق";

/** رمز QR كـ SVG من رمز التذكرة (محتوى الرمز هو المعرّف العشوائي فقط) */
export async function qrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#28182C", light: "#FFFFFF" } });
}

/**
 * إصدار/تفعيل التذاكر لتسجيل مؤكد. التذكرة فريدة لكل (تسجيل، نوع)، لذلك
 * تكرار التأكيد لا يصدر تذاكر إضافية. عند إعادة التفعيل بعد إلغاء يتغير الرمز.
 */
export async function issueTickets(
  tx: Tx,
  params: { eventId: string; registrationId: string; holderName: string; withCompanion: boolean },
) {
  const kinds: ("PRIMARY" | "COMPANION")[] = params.withCompanion ? ["PRIMARY", "COMPANION"] : ["PRIMARY"];
  for (const kind of kinds) {
    const holderName = kind === "PRIMARY" ? params.holderName : COMPANION_LABEL;
    const existing = await tx.ticket.findUnique({
      where: { registrationId_kind: { registrationId: params.registrationId, kind } },
    });
    if (!existing) {
      await tx.ticket.create({
        data: { eventId: params.eventId, registrationId: params.registrationId, kind, holderName, code: ticketCode() },
      });
    } else if (existing.status !== "ACTIVE") {
      await tx.ticket.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", holderName, code: ticketCode() },
      });
    } else if (existing.holderName !== holderName) {
      await tx.ticket.update({ where: { id: existing.id }, data: { holderName } });
    }
  }
  if (!params.withCompanion) {
    await tx.ticket.updateMany({
      where: { registrationId: params.registrationId, kind: "COMPANION", status: "ACTIVE", checkedInAt: null },
      data: { status: "CANCELLED" },
    });
  }
  return tx.ticket.findMany({
    where: { registrationId: params.registrationId, status: "ACTIVE" },
    orderBy: { kind: "desc" }, // PRIMARY قبل COMPANION
  });
}

export async function cancelTickets(tx: Tx, registrationId: string) {
  await tx.ticket.updateMany({ where: { registrationId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
}
