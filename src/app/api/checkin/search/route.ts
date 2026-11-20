import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchTickets } from "@/services/checkin";
import { AppError, errorMessage } from "@/lib/errors";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "سجّل الدخول أولًا" }, { status: 401 });
  const url = new URL(req.url);
  try {
    const results = await searchTickets(user.id, url.searchParams.get("eventId") ?? "", url.searchParams.get("q") ?? "");
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: e instanceof AppError ? e.status : 500 });
  }
}
