import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { designStatusLabel } from "@/lib/labels";
import { brand } from "@/config/brand";
import { Flash, PageHeader, Badge, Money } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { Thread } from "@/components/Thread";
import { LayoutSelect, PaletteFields } from "@/components/PaletteFields";
import {
  quoteDesignAction,
  rejectDesignAction,
  progressDesignAction,
  deliverDesignAction,
  adminDesignCommentAction,
} from "@/app/actions/admin";

export default async function AdminDesignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const admin = await requireAdmin();
  const r = await prisma.designRequest.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
      event: { select: { title: true } },
      comments: { include: { author: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: "asc" } },
      payments: true,
      deliveredTemplate: true,
    },
  });
  if (!r) notFound();
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader
        title={r.title}
        subtitle={
          <span>
            <Badge tone="info">{designStatusLabel[r.status]}</Badge> · {r.owner.name} (<bdi className="ltr">{r.owner.email}</bdi>) ·{" "}
            {formatDateTime(r.createdAt)}
          </span>
        }
        back={{ href: "/admin/designs", label: "طلبات التصميم" }}
      />
      <div className="grid-2">
        <div className="card stack-sm">
          <h3>الطلب</h3>
          <div style={{ whiteSpace: "pre-wrap" }}>{r.details}</div>
          {r.referenceUrl ? (
            <a href={r.referenceUrl} target="_blank" rel="noopener noreferrer" className="small ltr">
              {r.referenceUrl}
            </a>
          ) : null}
          {r.event ? <div className="small muted">الفعالية: {r.event.title}</div> : null}
          {r.quoteAmount ? (
            <div className="card-lilac small">
              العرض الحالي: <Money value={r.quoteAmount} />
              {r.quoteValidUntil ? ` · صالح حتى ${formatDateTime(r.quoteValidUntil)}` : ""}
            </div>
          ) : null}
        </div>

        <div className="card stack-sm">
          {["SUBMITTED", "QUOTED"].includes(r.status) ? (
            <>
              <h3>{r.status === "QUOTED" ? "تحديث عرض السعر" : "إرسال عرض سعر"}</h3>
              <form action={quoteDesignAction} className="stack-sm">
                <input type="hidden" name="requestId" value={r.id} />
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="amount">المبلغ (ريال)</label>
                    <input id="amount" name="amount" className="input ltr-input" required defaultValue={r.quoteAmount ? r.quoteAmount / 100 : ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="validDays">الصلاحية (أيام)</label>
                    <input id="validDays" name="validDays" type="number" className="input ltr-input" defaultValue={14} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="notes">ملاحظات العرض</label>
                  <textarea id="notes" name="notes" className="textarea" defaultValue={r.quoteNotes ?? ""} placeholder="ما يشمله العرض، مدة التنفيذ، عدد التعديلات…" />
                </div>
                <SubmitButton className="btn btn-primary">إرسال العرض</SubmitButton>
              </form>
              <form action={rejectDesignAction} className="stack-sm">
                <input type="hidden" name="requestId" value={r.id} />
                <input name="reason" className="input" placeholder="سبب الرفض (يظهر للمنظّم)" />
                <SubmitButton className="btn btn-sm btn-danger" confirm="رفض الطلب؟">
                  رفض الطلب
                </SubmitButton>
              </form>
            </>
          ) : null}
          {r.status === "ACCEPTED" ? <div className="alert alert-info">قبل المنظّم العرض وبانتظار الدفع.</div> : null}
          {r.status === "PAID" ? (
            <form action={progressDesignAction}>
              <input type="hidden" name="requestId" value={r.id} />
              <SubmitButton className="btn btn-dark">بدء التنفيذ</SubmitButton>
            </form>
          ) : null}
          {["PAID", "IN_PROGRESS"].includes(r.status) ? (
            <>
              <h3>تسليم التصميم كقالب خاص</h3>
              <form action={deliverDesignAction} className="stack-sm">
                <input type="hidden" name="requestId" value={r.id} />
                <div className="field">
                  <label htmlFor="tname">اسم القالب</label>
                  <input id="tname" name="name" className="input" required defaultValue={`تصميم خاص — ${r.title}`} />
                </div>
                <LayoutSelect id="dlayout" />
                <PaletteFields
                  idPrefix="d"
                  p={{ primary: brand.colors.plum, accent: brand.colors.lime, background: brand.colors.ivory, text: brand.colors.plum, muted: brand.colors.muted }}
                />
                <SubmitButton className="btn btn-primary">تسليم</SubmitButton>
              </form>
            </>
          ) : null}
          {r.status === "DELIVERED" ? <div className="alert alert-ok">سُلّم كقالب «{r.deliveredTemplate?.name}».</div> : null}
          {["REJECTED", "CANCELLED"].includes(r.status) ? <div className="alert alert-info">الطلب مغلق.</div> : null}
        </div>
      </div>
      <section className="card stack-sm">
        <h3>المراسلات مع المنظّم</h3>
        <Thread comments={r.comments} action={adminDesignCommentAction} hidden={{ requestId: r.id }} viewerId={admin.id} />
      </section>
    </div>
  );
}
