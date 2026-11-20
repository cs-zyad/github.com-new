import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { designStatusLabel } from "@/lib/labels";
import { PageHeader, Badge, Empty, Money } from "@/components/ui";

export const metadata = { title: "طلبات التصميم" };

export default async function AdminDesigns() {
  const list = await prisma.designRequest.findMany({
    orderBy: { updatedAt: "desc" },
    include: { owner: { select: { name: true, email: true } } },
    take: 200,
  });
  return (
    <div className="stack">
      <PageHeader title="طلبات التصميم الخاص" subtitle="راجع الطلب، أرسل عرض سعر، وبعد دفع المنظّم سلّم التصميم كقالب خاص به." />
      {list.length === 0 ? (
        <Empty>لا توجد طلبات.</Empty>
      ) : (
        <div className="list">
          {list.map((r) => (
            <Link key={r.id} href={`/admin/designs/${r.id}`} className="list-item" style={{ textDecoration: "none", display: "block" }}>
              <div className="row-between">
                <span className="title">{r.title}</span>
                <Badge tone={["SUBMITTED", "PAID", "IN_PROGRESS"].includes(r.status) ? "warn" : r.status === "DELIVERED" ? "ok" : "neutral"}>
                  {designStatusLabel[r.status]}
                </Badge>
              </div>
              <div className="small muted">
                {r.owner.name} · <bdi className="ltr">{r.owner.email}</bdi> · {formatDateTime(r.createdAt)}
                {r.quoteAmount ? (
                  <>
                    {" "}
                    · <Money value={r.quoteAmount} />
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
