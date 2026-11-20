import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NavLinks } from "@/components/NavLinks";
import { EventStatusBadge, Badge } from "@/components/ui";
import { modeLabel } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const event = await prisma.event.findFirst({ where: { id, ownerId: user.id } });
  if (!event) notFound();
  const base = `/dashboard/events/${event.id}`;
  const tabs =
    event.mode === "PRIVATE"
      ? [
          { href: base, label: "نظرة عامة", exact: true },
          { href: `${base}/guests`, label: "المدعوون" },
          { href: `${base}/send`, label: "الإرسال والتذكيرات" },
          { href: `${base}/waitlist`, label: "قائمة الانتظار" },
          { href: `${base}/template`, label: "القالب والمعاينة" },
          { href: `${base}/billing`, label: "الباقة والدفع" },
          { href: `${base}/staff`, label: "فريق الاستقبال" },
          { href: `${base}/edit`, label: "البيانات" },
        ]
      : [
          { href: base, label: "نظرة عامة", exact: true },
          { href: `${base}/guests`, label: "المسجلون" },
          { href: `${base}/waitlist`, label: "قائمة الانتظار" },
          { href: `${base}/template`, label: "القالب والمعاينة" },
          { href: `${base}/billing`, label: "الباقة والرابط العام" },
          { href: `${base}/staff`, label: "فريق الاستقبال" },
          { href: `${base}/edit`, label: "البيانات" },
        ];
  return (
    <div>
      <div style={{ marginBottom: "0.75rem" }}>
        <div className="row" style={{ gap: "0.5rem" }}>
          <EventStatusBadge status={event.status} />
          <Badge tone="info">{modeLabel[event.mode]}</Badge>
          <span className="small muted">{formatDateTime(event.startsAt, event.timezone)}</span>
        </div>
        <h1 style={{ marginTop: "0.35rem", marginBottom: 0 }}>{event.title}</h1>
      </div>
      <NavLinks items={tabs} className="tabs" />
      {children}
    </div>
  );
}
