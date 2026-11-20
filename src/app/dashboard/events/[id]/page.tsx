import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { recentCheckIns } from "@/services/checkin";
import { getOwnedEvent, eventStats } from "@/services/events";
import { links } from "@/services/presentation";
import { formatDateTime, formatTime } from "@/lib/format";
import { fullPolicyLabel, checkInMethodLabel } from "@/lib/labels";
import { Flash, Stat, Badge } from "@/components/ui";
import { AutoRefresh, CopyField, SubmitButton } from "@/components/client";
import { cancelEventAction, deleteDraftAction } from "@/app/actions/events";

export default async function EventOverview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  const s = await eventStats(event);
  const base = `/dashboard/events/${event.id}`;
  const recent = await recentCheckIns(event.id, 6);

  const isPrivate = event.mode === "PRIVATE";
  const paid = event.paidPlaces > 0;
  const steps = [
    { label: "البيانات", done: true, href: `${base}/edit` },
    { label: "القالب والمعاينة", done: !!event.templateId, href: `${base}/template` },
    isPrivate
      ? { label: "المدعوون", done: s.invitations > 0, href: `${base}/guests` }
      : { label: "السعة", done: event.capacity > 0, href: `${base}/edit` },
    { label: "الدفع", done: paid && s.requiredPlaces <= event.paidPlaces, href: `${base}/billing` },
    isPrivate
      ? { label: "إرسال الدعوات", done: s.invitations > 0 && s.notSent === 0, href: `${base}/send` }
      : { label: "نشر الرابط", done: !!event.publicSlug, href: `${base}/billing` },
  ];
  const current = steps.findIndex((x) => !x.done);
  const fillPct = s.seatLimit ? Math.min(100, Math.round((s.reservedSeats / s.seatLimit) * 100)) : 0;

  return (
    <div className="stack">
      {event.status === "ACTIVE" ? <AutoRefresh seconds={30} /> : null}
      <Flash sp={sp} />

      {event.status !== "CANCELLED" ? (
        <ol className="steps" aria-label="خطوات التجهيز">
          {steps.map((st, i) => (
            <li key={st.label} className={st.done ? "done" : i === current ? "current" : ""}>
              <span className="n">{st.done ? "✓" : i + 1}</span>
              <Link href={st.href}>{st.label}</Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="alert alert-err">الفعالية ملغاة.</div>
      )}

      {event.mode === "PUBLIC" && event.publicSlug ? (
        <div className="card-lilac stack-sm">
          <strong>الرابط العام</strong>
          <CopyField text={links.publicEvent(event.publicSlug)} />
        </div>
      ) : null}

      <section>
        <div className="row-between" style={{ marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>الأرقام</h2>
          <span className="small muted">تتحدث تلقائيًا</span>
        </div>
        <div className="grid-stats">
          {isPrivate ? (
            <>
              <Stat label="الدعوات" value={s.invitations} hint={`${s.invitationPeople} شخص بالمرافقين المسموحين`} />
              <Stat label="لم يؤكد" value={s.notConfirmed} hint="دعوات بلا رد" />
            </>
          ) : (
            <Stat label="المسجلون" value={s.confirmedRegistrations} hint="تسجيلات مؤكدة" />
          )}
          <Stat label="المؤكدون" value={s.confirmedPeople} hint={`${s.confirmedRegistrations} دعوة/تسجيل`} />
          <Stat label="الحاضرون" value={s.attendedPeople} hint={`${s.attendedGuests} ضيف + ${s.attendedCompanions} مرافق`} highlight />
          <Stat label="المقاعد المتاحة" value={s.availableSeats} hint={`من ${s.seatLimit}`} />
          {isPrivate ? (
            <Stat label="تعذّر الإرسال" value={s.deliveryFailed} hint={s.notSent ? `${s.notSent} لم تُرسل بعد` : undefined} />
          ) : (
            <Stat label="قائمة الانتظار" value={s.waitlisted + s.offered} />
          )}
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <div className="row-between small muted">
            <span>المحجوز {s.reservedSeats} من {s.seatLimit}</span>
            <span>{fillPct}%</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={fillPct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${fillPct}%` }} />
          </div>
        </div>
      </section>

      <div className="grid-2">
        <div className="card">
          <h3>تفاصيل</h3>
          <dl className="kv">
            <dt>الموعد</dt>
            <dd>{formatDateTime(event.startsAt, event.timezone)}</dd>
            <dt>المكان</dt>
            <dd>{event.venueName}</dd>
            <dt>اكتمال العدد</dt>
            <dd>{fullPolicyLabel[event.fullPolicy]}</dd>
            <dt>الباقة</dt>
            <dd>
              {paid ? `${event.paidPlaces} مكان مدفوع` : "لم تُدفع بعد"}
              {isPrivate && paid ? ` — المطلوب ${s.requiredPlaces}` : ""}
            </dd>
            {isPrivate ? (
              <>
                <dt>اعتذر</dt>
                <dd>{s.declined}</dd>
                <dt>الانتظار</dt>
                <dd>{s.waitlisted + s.offered}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>آخر من حضر</h3>
            <Link href={`/checkin/${event.id}`} className="btn btn-sm btn-dark">
              فتح التحضير
            </Link>
          </div>
          {recent.length ? (
            <div className="list">
              {recent.map((t) => (
                <div key={t.id} className="row-between small">
                  <span>
                    {t.kind === "COMPANION" ? `مرافق — ${t.primaryName}` : t.holderName}{" "}
                    <Badge tone="neutral">{checkInMethodLabel[t.checkInMethod ?? "SCAN"]}</Badge>
                  </span>
                  <span className="muted">
                    {formatTime(t.checkedInAt, event.timezone)} · {t.checkedInByName}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">لم يُسجّل حضور بعد.</p>
          )}
        </div>
      </div>

      <div className="row">
        <a className="btn" href={`/api/events/${event.id}/export`}>
          تنزيل كشف الحضور (CSV)
        </a>
        <Link className="btn" href={`/dashboard/events/${event.id}/messages`}>
          سجل الرسائل
        </Link>
        {event.status === "DRAFT" && !paid ? (
          <form action={deleteDraftAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <SubmitButton className="btn btn-danger" confirm="حذف المسودة نهائيًا؟">
              حذف المسودة
            </SubmitButton>
          </form>
        ) : null}
        {event.status === "ACTIVE" ? (
          <form action={cancelEventAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <SubmitButton className="btn btn-danger" confirm="إلغاء الفعالية؟ لن يستطيع الضيوف التأكيد وستتوقف التذكيرات.">
              إلغاء الفعالية
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
