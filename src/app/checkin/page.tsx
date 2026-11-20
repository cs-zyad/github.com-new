import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { checkInEventsFor } from "@/services/staff";
import { formatDateTime } from "@/lib/format";
import { Empty } from "@/components/ui";

export default async function CheckinHome() {
  const user = await requireUser();
  const events = await checkInEventsFor(user.id);
  return (
    <div className="stack">
      <div>
        <h1>التحضير</h1>
        <p className="muted">اختر الفعالية لبدء مسح التذاكر وتسجيل الحضور.</p>
      </div>
      {events.length === 0 ? (
        <Empty>لا توجد فعاليات نشطة مسندة إليك. اطلب من المنظّم إضافتك لفريق الاستقبال.</Empty>
      ) : (
        <div className="list">
          {events.map((e) => (
            <Link key={e.id} href={`/checkin/${e.id}`} className="list-item" style={{ textDecoration: "none", display: "block" }}>
              <div className="row-between">
                <span className="title">{e.title}</span>
                <span className="btn btn-sm btn-dark">سجّل الحضور</span>
              </div>
              <div className="small muted">
                {formatDateTime(e.startsAt, e.timezone)} · {e.venueName}
                {e.ownerId === user.id ? " · فعاليتك" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
      {user.role !== "ADMIN" ? (
        <p className="small">
          <Link href="/dashboard">لوحة المنظّم</Link>
        </p>
      ) : null}
    </div>
  );
}
