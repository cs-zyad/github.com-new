import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { supportCategoryLabel, supportStatusLabel } from "@/lib/labels";
import { Flash, PageHeader, Badge } from "@/components/ui";
import { Thread } from "@/components/Thread";
import { supportCommentAction } from "@/app/actions/account";

export default async function SupportDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const t = await prisma.supportTicket.findFirst({
    where: { id, ownerId: user.id },
    include: {
      comments: { include: { author: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: "asc" } },
      event: { select: { title: true } },
    },
  });
  if (!t) notFound();
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader
        title={t.subject}
        subtitle={
          <span>
            <Badge tone="info">{supportCategoryLabel[t.category]}</Badge> <Badge tone="warn">{supportStatusLabel[t.status]}</Badge> ·{" "}
            {formatDateTime(t.createdAt)}
            {t.event ? ` · ${t.event.title}` : ""}
          </span>
        }
        back={{ href: "/dashboard/support", label: "الدعم" }}
      />
      <div className="card" style={{ whiteSpace: "pre-wrap" }}>
        {t.body}
      </div>
      <section className="card stack-sm">
        <h3>المراسلات</h3>
        <Thread comments={t.comments} action={supportCommentAction} hidden={{ ticketId: t.id }} viewerId={user.id} />
      </section>
    </div>
  );
}
