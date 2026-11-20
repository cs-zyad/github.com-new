import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { deliveryLabel, regStatusLabel, checkInMethodLabel } from "@/lib/labels";

function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // منع حقن الصيغ في Excel
  return `"${s.replace(/"/g, '""')}"`;
}

/** كشف الحضور: صف لكل شخص (الضيف والمرافق) + الدعوات التي لم يرد أصحابها */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const event = await prisma.event.findFirst({ where: { id, ownerId: user.id } });
  if (!event) return new Response("Not found", { status: 404 });

  const header = ["الاسم", "النوع", "الجوال", "البريد", "حالة الدعوة", "حالة التأكيد", "الحضور", "وقت الدخول", "طريقة التحضير", "سجّله"];
  const lines: string[][] = [];

  const regs = await prisma.registration.findMany({
    where: { eventId: event.id },
    include: { tickets: { include: { checkedInBy: { select: { name: true } } } }, invitation: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of regs) {
    const tickets = r.tickets.filter((t) => t.status === "ACTIVE");
    const base = [r.phone ?? "", r.email ?? "", r.invitation ? deliveryLabel[r.invitation.deliveryStatus] : "رابط عام", regStatusLabel[r.status]];
    if (!tickets.length) {
      lines.push([r.name, "ضيف", ...base, "", "", "", ""]);
      continue;
    }
    for (const t of tickets) {
      lines.push([
        t.kind === "COMPANION" ? `مرافق — ${r.name}` : r.name,
        t.kind === "COMPANION" ? "مرافق" : "ضيف",
        ...base,
        t.checkedInAt ? "حضر" : "لم يحضر",
        t.checkedInAt ? formatDateTime(t.checkedInAt, event.timezone) : "",
        t.checkInMethod ? checkInMethodLabel[t.checkInMethod] : "",
        t.checkedInBy?.name ?? "",
      ]);
    }
  }
  if (event.mode === "PRIVATE") {
    const pending = await prisma.invitation.findMany({ where: { eventId: event.id, registration: null }, orderBy: { createdAt: "asc" } });
    for (const inv of pending) {
      lines.push([inv.name, "ضيف", inv.phone ?? "", inv.email ?? "", deliveryLabel[inv.deliveryStatus], "لم يؤكد", "", "", "", ""]);
    }
  }
  const csv = "﻿" + [header, ...lines].map((l) => l.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${event.id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
