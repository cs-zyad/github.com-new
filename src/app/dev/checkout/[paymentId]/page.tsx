import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { C, getDoc } from "@/lib/firestore";
import type { Payment } from "@/lib/types";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { paymentPurposeLabel, paymentStatusLabel } from "@/lib/labels";
import { TopBar } from "@/components/Shell";
import { Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { buildMockWebhook } from "@/providers/payments/mock";
import { handlePaymentWebhook } from "@/services/payments";

export const metadata = { title: "صفحة الدفع التجريبية", robots: { index: false } };

function returnPath(p: { purpose: string; eventId: string | null; designRequestId: string | null }) {
  if (p.eventId) return `/dashboard/events/${p.eventId}/billing`;
  if (p.designRequestId) return `/dashboard/designs/${p.designRequestId}`;
  return "/dashboard/wallet";
}

async function simulate(fd: FormData) {
  "use server";
  if (!env.demoMode) notFound();
  const user = await requireUser();
  const id = String(fd.get("paymentId"));
  const type = fd.get("type") === "failed" ? "payment.failed" : "payment.succeeded";
  const p = await getDoc<Payment>(C.payments, id);
  if (!p || p.ownerId !== user.id || p.provider !== "mock") notFound();
  // معرّف إشعار ثابت لكل عملية: الضغط مرة أخرى يعيد نفس الإشعار فيُثبت أنه لا يُعالج مرتين
  const wh = buildMockWebhook({
    providerRef: p.providerRef!,
    paymentId: p.id,
    amount: p.amount,
    currency: p.currency,
    type,
    eventId: `evt_mock_${p.id}_${type}`,
  });
  // نفس مسار المزوّد الفعلي: تحقق من التوقيع ثم معالجة مرة واحدة
  const r = await handlePaymentWebhook(wh.rawBody, wh.headers, "mock");
  const msg =
    r.outcome === "PROCESSED"
      ? type === "payment.succeeded"
        ? "تم الدفع وتثبيته من الخادم"
        : "سُجّل فشل الدفع"
      : r.outcome === "DUPLICATE"
        ? "إشعار مكرر — لم يُعالج مرة أخرى ولم تتكرر الإضافة"
        : r.message || r.outcome;
  if (fd.get("stay") === "1") redirect(`/dev/checkout/${p.id}?result=${encodeURIComponent(msg)}`);
  const back = returnPath(p);
  redirect(`${back}?${r.outcome === "PROCESSED" && type === "payment.succeeded" ? "ok" : "error"}=${encodeURIComponent(msg)}`);
}

export default async function MockCheckout({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  if (!env.demoMode) notFound();
  const [{ paymentId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const p = await getDoc<Payment>(C.payments, paymentId);
  if (!p || p.ownerId !== user.id) notFound();
  return (
    <>
      <TopBar user={user} />
      <main className="container narrow" style={{ padding: "2rem 16px 3rem" }}>
        <div className="card stack">
          <div className="alert alert-warn small">
            صفحة دفع تجريبية تحاكي مزوّد الدفع. لا يتم خصم أي مبلغ فعلي. عند الضغط تُرسل إشارة موقّعة لنفس مسار تأكيد الدفع في الخادم.
          </div>
          <h1>إتمام الدفع</h1>
          <dl className="kv">
            <dt>الغرض</dt>
            <dd>{paymentPurposeLabel[p.purpose]}</dd>
            <dt>الوصف</dt>
            <dd>{p.description}</dd>
            {p.places ? (
              <>
                <dt>الأماكن</dt>
                <dd>{p.places}</dd>
              </>
            ) : null}
            <dt>المبلغ</dt>
            <dd>
              <strong className="money" style={{ fontSize: "1.3rem" }}>
                {formatMoney(p.amount, p.currency)}
              </strong>
            </dd>
            <dt>الحالة</dt>
            <dd>
              <Badge tone={p.status === "PAID" ? "ok" : p.status === "PENDING" ? "warn" : "neutral"}>{paymentStatusLabel[p.status]}</Badge>
            </dd>
          </dl>
          {sp.result ? <div className="alert alert-info">{sp.result}</div> : null}
          {p.status !== "PAID" ? (
            <div className="stack-sm">
              <form action={simulate}>
                <input type="hidden" name="paymentId" value={p.id} />
                <input type="hidden" name="type" value="succeeded" />
                <SubmitButton className="btn btn-primary btn-lg btn-block">ادفع {formatMoney(p.amount, p.currency)} (تجريبي)</SubmitButton>
              </form>
              <form action={simulate}>
                <input type="hidden" name="paymentId" value={p.id} />
                <input type="hidden" name="type" value="failed" />
                <input type="hidden" name="stay" value="1" />
                <SubmitButton className="btn btn-block">محاكاة فشل الدفع</SubmitButton>
              </form>
            </div>
          ) : (
            <div className="stack-sm">
              <div className="alert alert-ok">العملية مدفوعة ومثبتة.</div>
              <form action={simulate}>
                <input type="hidden" name="paymentId" value={p.id} />
                <input type="hidden" name="type" value="succeeded" />
                <input type="hidden" name="stay" value="1" />
                <SubmitButton className="btn btn-block">إعادة إرسال نفس إشعار الدفع (اختبار التكرار)</SubmitButton>
              </form>
              <Link href={returnPath(p)} className="btn btn-dark btn-block">
                العودة
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
