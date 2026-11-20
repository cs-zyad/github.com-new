import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { designRequestDetail } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { designStatusLabel } from "@/lib/labels";
import { Flash, PageHeader, Badge, Money } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { Thread } from "@/components/Thread";
import { acceptQuoteAction, payDesignAction, cancelDesignAction, designCommentAction } from "@/app/actions/account";

export default async function DesignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const r = await designRequestDetail(id, user.id);
  if (!r) notFound();
  const expired = r.quoteValidUntil && r.quoteValidUntil < new Date();
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader
        title={r.title}
        subtitle={
          <span>
            <Badge tone="info">{designStatusLabel[r.status]}</Badge> · أُرسل {formatDateTime(r.createdAt)}
          </span>
        }
        back={{ href: "/dashboard/designs", label: "طلبات التصميم" }}
      />
      <div className="grid-2">
        <div className="card stack-sm">
          <h3>تفاصيل الطلب</h3>
          <div style={{ whiteSpace: "pre-wrap" }}>{r.details}</div>
          {r.referenceUrl ? (
            <a href={r.referenceUrl} target="_blank" rel="noopener noreferrer" className="small">
              الرابط المرجعي
            </a>
          ) : null}
          {r.event ? <div className="small muted">الفعالية: {r.event.title}</div> : null}
        </div>
        <div className="card stack-sm">
          <h3>عرض السعر</h3>
          {r.quoteAmount ? (
            <>
              <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>
                <Money value={r.quoteAmount} />
              </div>
              {r.quoteNotes ? <div style={{ whiteSpace: "pre-wrap" }}>{r.quoteNotes}</div> : null}
              {r.quoteValidUntil ? <div className="small muted">صالح حتى {formatDateTime(r.quoteValidUntil)}</div> : null}
              {r.status === "QUOTED" && !expired ? (
                <form action={acceptQuoteAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <SubmitButton className="btn btn-primary">قبول العرض والدفع</SubmitButton>
                </form>
              ) : null}
              {r.status === "QUOTED" && expired ? <div className="alert alert-warn small">انتهت صلاحية العرض. راسل الفريق لتحديثه.</div> : null}
              {r.status === "ACCEPTED" ? (
                <form action={payDesignAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <SubmitButton className="btn btn-primary">إكمال الدفع</SubmitButton>
                </form>
              ) : null}
            </>
          ) : (
            <p className="muted small">بانتظار مراجعة فريق المنصة وإرسال العرض.</p>
          )}
          {r.status === "DELIVERED" && r.deliveredTemplate ? (
            <div className="alert alert-ok">
              سُلّم التصميم كقالب خاص باسم «{r.deliveredTemplate.name}». تجده عند اختيار القالب لأي فعالية.
              {r.event ? (
                <>
                  {" "}
                  <Link href={`/dashboard/events/${r.event.id}/template`}>اختره الآن</Link>
                </>
              ) : null}
            </div>
          ) : null}
          {["SUBMITTED", "QUOTED", "ACCEPTED"].includes(r.status) ? (
            <form action={cancelDesignAction}>
              <input type="hidden" name="requestId" value={r.id} />
              <SubmitButton className="btn btn-sm btn-ghost" confirm="إلغاء الطلب؟">
                إلغاء الطلب
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>
      <section className="card stack-sm">
        <h3>المراسلات</h3>
        <Thread comments={r.comments} action={designCommentAction} hidden={{ requestId: r.id }} viewerId={user.id} disabled={r.status === "CANCELLED"} />
      </section>
    </div>
  );
}
