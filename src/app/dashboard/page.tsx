import Link from "next/link";
import { ownerEvents, staffAssignmentCount } from "@/services/queries";
import { requireUser } from "@/lib/auth";
import { getBalance } from "@/services/wallet";
import { seatLimit } from "@/services/events";
import { formatDateTime } from "@/lib/format";
import { modeLabel } from "@/lib/labels";
import { EventStatusBadge, Flash, Money, PageHeader, Empty, Badge } from "@/components/ui";

export const metadata = { title: "الفعاليات" };

export default async function DashboardHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [events, balance, staffEvents] = await Promise.all([
    ownerEvents(user.id),
    getBalance(user.id),
    staffAssignmentCount(user.id),
  ]);
  const now = Date.now();
  const drafts = events.filter((e) => e.status === "DRAFT");
  const active = events.filter((e) => e.status === "ACTIVE" && (e.endsAt ?? e.startsAt).getTime() > now - 6 * 3600_000);
  const past = events.filter((e) => !drafts.includes(e) && !active.includes(e));

  const list = (items: typeof events) => (
    <div className="list">
      {items.map((e) => (
        <Link key={e.id} href={`/dashboard/events/${e.id}`} className="list-item" style={{ textDecoration: "none", display: "block" }}>
          <div className="row-between">
            <span className="title">{e.title}</span>
            <EventStatusBadge status={e.status} />
          </div>
          <div className="row small muted" style={{ gap: "0.4rem 1rem", marginTop: 4 }}>
            <span>{formatDateTime(e.startsAt, e.timezone)}</span>
            <span>{modeLabel[e.mode]}</span>
            <span>
              المحجوز <bdi className="ltr">{e.reservedSeats}</bdi> من <bdi className="ltr">{seatLimit(e)}</bdi>
            </span>
            {e.mode === "PRIVATE" ? (
              <span>
                الدعوات <bdi className="ltr">{e.invitationCount}</bdi>
              </span>
            ) : null}
          </div>
        </Link>
      ))}
    </div>
  );

  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader
        title={`أهلًا ${user.name}`}
        subtitle="من دُعي ومن أكّد ومن حضر — في مكان واحد."
        actions={
          <Link href="/dashboard/events/new" className="btn btn-primary">
            + فعالية جديدة
          </Link>
        }
      />
      <div className="grid-3">
        <div className="stat highlight">
          <div className="label">رصيد الرسائل</div>
          <div className="value">
            <Money value={balance} />
          </div>
          <div className="hint">
            <Link href="/dashboard/wallet" style={{ color: "var(--lime)" }}>
              شحن الرصيد
            </Link>
          </div>
        </div>
        <div className="stat">
          <div className="label">فعاليات نشطة</div>
          <div className="value">{active.length}</div>
        </div>
        <div className="stat">
          <div className="label">مسودات</div>
          <div className="value">{drafts.length}</div>
        </div>
      </div>

      {staffEvents > 0 ? (
        <div className="alert alert-info">
          أنت ضمن فريق الاستقبال في {staffEvents} فعالية. <Link href="/checkin">افتح صفحة التحضير</Link>
        </div>
      ) : null}

      <section className="stack-sm">
        <h2>الفعاليات النشطة</h2>
        {active.length ? list(active) : <Empty>لا توجد فعاليات نشطة. ابدأ بإنشاء فعالية ثم ادفع الباقة لتفعيلها.</Empty>}
      </section>
      <section className="stack-sm">
        <h2>المسودات</h2>
        {drafts.length ? list(drafts) : <Empty>لا توجد مسودات.</Empty>}
      </section>
      {past.length ? (
        <section className="stack-sm">
          <h2>
            السابقة والملغاة <Badge tone="neutral">{past.length}</Badge>
          </h2>
          {list(past)}
        </section>
      ) : null}
    </div>
  );
}
