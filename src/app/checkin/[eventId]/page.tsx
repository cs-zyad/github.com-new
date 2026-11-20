import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canWorkCheckIn } from "@/services/events";
import { checkInSummary } from "@/services/checkin";
import { formatDateTime } from "@/lib/format";
import { Scanner } from "./Scanner";

export default async function CheckinEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireUser();
  // التحقق في الخادم: المالك أو عضو معيّن على هذه الفعالية فقط
  if (!(await canWorkCheckIn(user.id, eventId))) {
    return (
      <div className="stack">
        <div className="alert alert-err">لست ضمن فريق الاستقبال لهذه الفعالية.</div>
        <Link href="/checkin">العودة لقائمة الفعاليات</Link>
      </div>
    );
  }
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) notFound();
  const summary = await checkInSummary(event.id);

  return (
    <div className="stack">
      <div>
        <Link href="/checkin" className="small muted" style={{ textDecoration: "none" }}>
          → الفعاليات
        </Link>
        <h1 style={{ marginBottom: 0 }}>{event.title}</h1>
        <div className="small muted">
          {formatDateTime(event.startsAt, event.timezone)} · {event.venueName}
        </div>
      </div>
      {event.status !== "ACTIVE" ? (
        <div className="alert alert-err">الفعالية غير نشطة — لا يمكن تسجيل الحضور.</div>
      ) : (
        <Scanner eventId={event.id} initialAttended={summary.attended} totalTickets={summary.totalTickets} />
      )}
    </div>
  );
}
