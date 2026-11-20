import { notFound } from "next/navigation";
import { supportTicketDetail } from "@/services/queries";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { supportCategoryLabel, supportStatusLabel } from "@/lib/labels";
import { Flash, PageHeader, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { Thread } from "@/components/Thread";
import { adminSupportCommentAction, supportStatusAction } from "@/app/actions/admin";

export default async function AdminSupportDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const admin = await requireAdmin();
  const t = await supportTicketDetail(id);
  if (!t) notFound();
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader
        title={t.subject}
        subtitle={
          <span>
            <Badge tone="info">{supportCategoryLabel[t.category]}</Badge> <Badge tone="warn">{supportStatusLabel[t.status]}</Badge> · {t.owner?.name} (
            <bdi className="ltr">{t.owner?.email}</bdi>) · {formatDateTime(t.createdAt)}
            {t.event ? ` · ${t.event.title}` : ""}
          </span>
        }
        back={{ href: "/admin/support", label: "الشكاوى والدعم" }}
      />
      <div className="card" style={{ whiteSpace: "pre-wrap" }}>
        {t.body}
      </div>
      <form action={supportStatusAction} className="row card-lilac">
        <input type="hidden" name="ticketId" value={t.id} />
        <label htmlFor="status" className="label">
          الحالة:
        </label>
        <select id="status" name="status" className="select" style={{ width: "auto" }} defaultValue={t.status}>
          {Object.entries(supportStatusLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <SubmitButton className="btn btn-sm btn-dark">تحديث</SubmitButton>
      </form>
      <section className="card stack-sm">
        <h3>المراسلات</h3>
        <Thread comments={t.comments} action={adminSupportCommentAction} hidden={{ ticketId: t.id }} viewerId={admin.id} />
      </section>
    </div>
  );
}
