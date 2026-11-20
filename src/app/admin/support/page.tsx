import Link from "next/link";
import { adminSupportTickets } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { supportCategoryLabel, supportStatusLabel } from "@/lib/labels";
import { PageHeader, Badge, Empty } from "@/components/ui";

export const metadata = { title: "الشكاوى والدعم" };

export default async function AdminSupport({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const tickets = await adminSupportTickets(status === "open");
  return (
    <div className="stack">
      <PageHeader title="الشكاوى وطلبات الدعم" />
      <div className="tabs">
        <Link href="/admin/support?status=open" className={status === "open" ? "active" : undefined}>
          المفتوحة
        </Link>
        <Link href="/admin/support?status=all" className={status === "all" ? "active" : undefined}>
          الكل
        </Link>
      </div>
      {tickets.length === 0 ? (
        <Empty>لا توجد طلبات.</Empty>
      ) : (
        <div className="list">
          {tickets.map((t) => (
            <Link key={t.id} href={`/admin/support/${t.id}`} className="list-item" style={{ textDecoration: "none", display: "block" }}>
              <div className="row-between">
                <span className="title">{t.subject}</span>
                <span className="row" style={{ gap: 4 }}>
                  <Badge tone={t.category === "COMPLAINT" ? "err" : "info"}>{supportCategoryLabel[t.category]}</Badge>
                  <Badge tone={t.status === "OPEN" ? "warn" : t.status === "IN_PROGRESS" ? "info" : "ok"}>{supportStatusLabel[t.status]}</Badge>
                </span>
              </div>
              <div className="small muted">
                {t.owner.name} · {formatDateTime(t.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
