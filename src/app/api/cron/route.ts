import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { workerTick } from "@/services/worker";

/** دورة العامل من خدمة cron: Vercel Cron (Authorization: Bearer CRON_SECRET) أو GET /api/cron?key=CRON_SECRET */
export async function GET(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const key = bearer || new URL(req.url).searchParams.get("key") || req.headers.get("x-cron-key") || "";
  const secret = env.cronSecret;
  const ok = secret.length > 0 && key.length === secret.length && timingSafeEqual(Buffer.from(key), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await workerTick();
  return NextResponse.json(r);
}
