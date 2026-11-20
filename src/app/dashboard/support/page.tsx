import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ownerSupportTickets, ownerEventOptions } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { supportCategoryLabel, supportStatusLabel } from "@/lib/labels";
import { Flash, PageHeader, Badge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createSupportAction } from "@/app/actions/account";

export const metadata = { title: "الدعم" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [tickets, events] = await Promise.all([
    ownerSupportTickets(user.id),
    ownerEventOptions(user.id),
  ]);
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader title="الدعم والشكاوى" subtitle="راسل فريق المنصة بخصوص أي استفسار أو مشكلة أو شكوى." />
      <div className="grid-2">
        <form action={createSupportAction} className="card stack-sm">
          <h3>طلب جديد</h3>
          <div className="field">
            <label htmlFor="category">النوع</label>
            <select id="category" name="category" className="select" defaultValue="QUESTION">
              {Object.entries(supportCategoryLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="subject">العنوان</label>
            <input id="subject" name="subject" className="input" required minLength={3} />
          </div>
          <div className="field">
            <label htmlFor="eventId">الفعالية (اختياري)</label>
            <select id="eventId" name="eventId" className="select" defaultValue="">
              <option value="">بدون</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="body">التفاصيل</label>
            <textarea id="body" name="body" className="textarea" required minLength={10} />
          </div>
          <SubmitButton className="btn btn-primary">إرسال</SubmitButton>
        </form>
        <div className="stack-sm">
          <h3>طلباتك</h3>
          {tickets.length === 0 ? (
            <Empty>لا توجد طلبات.</Empty>
          ) : (
            <div className="list">
              {tickets.map((t) => (
                <Link key={t.id} href={`/dashboard/support/${t.id}`} className="list-item" style={{ textDecoration: "none", display: "block" }}>
                  <div className="row-between">
                    <span className="title">{t.subject}</span>
                    <Badge tone={t.status === "RESOLVED" || t.status === "CLOSED" ? "ok" : "warn"}>{supportStatusLabel[t.status]}</Badge>
                  </div>
                  <div className="small muted">
                    {supportCategoryLabel[t.category]} · {formatDateTime(t.updatedAt)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
