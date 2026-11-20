import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ownerDesignRequests } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { designStatusLabel } from "@/lib/labels";
import { Flash, PageHeader, Badge, Empty, Money } from "@/components/ui";

export const metadata = { title: "طلبات التصميم" };

export default async function DesignsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const list = await ownerDesignRequests(user.id);
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader
        title="طلبات التصميم الخاص"
        subtitle="اطلب تصميم دعوة خاصًا، ويراجعه فريق المنصة ويرسل لك عرض سعر هنا. بعد القبول والدفع يُسلّم كقالب خاص بحسابك."
        actions={
          <Link href="/dashboard/designs/new" className="btn btn-primary">
            + طلب جديد
          </Link>
        }
      />
      {list.length === 0 ? (
        <Empty>لا توجد طلبات بعد.</Empty>
      ) : (
        <div className="list">
          {list.map((r) => (
            <Link key={r.id} href={`/dashboard/designs/${r.id}`} className="list-item" style={{ textDecoration: "none", display: "block" }}>
              <div className="row-between">
                <span className="title">{r.title}</span>
                <Badge tone={r.status === "QUOTED" ? "warn" : r.status === "DELIVERED" ? "ok" : r.status === "REJECTED" || r.status === "CANCELLED" ? "neutral" : "info"}>
                  {designStatusLabel[r.status]}
                </Badge>
              </div>
              <div className="small muted">
                {formatDateTime(r.createdAt)}
                {r.quoteAmount ? (
                  <>
                    {" "}
                    · العرض <Money value={r.quoteAmount} />
                  </>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
