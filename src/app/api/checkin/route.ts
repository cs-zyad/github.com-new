import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkIn, extractTicketCode } from "@/services/checkin";
import { AppError, errorMessage } from "@/lib/errors";
import { sameOrigin } from "@/lib/http";

/** تسجيل الحضور (مسح أو يدوي) — التحقق من الصلاحية والفعالية والرمز يتم في الخادم */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ result: "ERROR", message: "طلب غير مسموح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ result: "ERROR", message: "سجّل الدخول أولًا" }, { status: 401 });
  let body: { eventId?: string; raw?: string; ticketId?: string; method?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ result: "ERROR", message: "طلب غير صالح" }, { status: 400 });
  }
  const eventId = String(body.eventId ?? "");
  const method = body.method === "MANUAL" ? "MANUAL" : "SCAN";
  try {
    if (method === "SCAN") {
      const code = extractTicketCode(String(body.raw ?? ""));
      if (!code) return NextResponse.json({ result: "INVALID", message: "رمز غير صالح" });
      return NextResponse.json(await checkIn({ staffUserId: user.id, eventId, method, code }));
    }
    if (!body.ticketId) return NextResponse.json({ result: "ERROR", message: "التذكرة غير محددة" }, { status: 400 });
    return NextResponse.json(await checkIn({ staffUserId: user.id, eventId, method, ticketId: String(body.ticketId) }));
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ result: "ERROR", message: errorMessage(e) }, { status });
  }
}
