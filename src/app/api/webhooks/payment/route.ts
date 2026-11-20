import { NextResponse } from "next/server";
import { handlePaymentWebhook } from "@/services/payments";

/**
 * نقطة استقبال إشعارات الدفع من المزوّد. التوقيع يُتحقق منه داخل المزوّد،
 * والمعالجة مرة واحدة لكل إشعار. نعيد 200 للإشعار المكرر حتى يتوقف المزوّد عن الإعادة.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const r = await handlePaymentWebhook(raw, req.headers);
    if (r.outcome === "REJECTED") return NextResponse.json(r, { status: 400 });
    return NextResponse.json(r);
  } catch (e) {
    console.error("[payment webhook]", e);
    // 500 → المزوّد يعيد المحاولة لاحقًا، والمعاملة لم تُسجّل شيئًا
    return NextResponse.json({ outcome: "ERROR" }, { status: 500 });
  }
}
