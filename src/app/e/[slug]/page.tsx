import { notFound } from "next/navigation";
import { eventBySlug } from "@/services/queries";
import { randomToken } from "@/lib/ids";
import { eventView } from "@/services/presentation";
import { parsePalette } from "@/services/designs";
import { rsvpClosedReason } from "@/services/rsvp";
import { availableSeats } from "@/services/events";
import { InvitationCard } from "@/components/InvitationCard";
import { GuestShell, ResultBox } from "@/components/GuestShell";
import { PublicForm } from "./PublicForm";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await eventBySlug(slug);
  return { title: e?.title ?? "فعالية" };
}

export default async function PublicEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await eventBySlug(slug);
  if (!event || event.mode !== "PUBLIC") notFound();
  const view = eventView(event);
  const closed = rsvpClosedReason(event);
  const free = availableSeats(event);

  return (
    <GuestShell>
      <div className="stack">
        <InvitationCard layout={event.template?.layout ?? "plum-frame"} palette={parsePalette(event.template?.palette ?? "")} view={view} mode="PUBLIC" />
        {view.mapUrl ? (
          <a className="btn btn-block" href={view.mapUrl} target="_blank" rel="noopener noreferrer">
            الموقع على الخريطة
          </a>
        ) : null}
        {closed === "CANCELLED" ? (
          <ResultBox tone="err" icon="✕" title="أُلغيت الفعالية" />
        ) : closed ? (
          <ResultBox tone="info" icon="✓" title={closed === "ENDED" ? "انتهت الفعالية" : "التسجيل غير متاح حاليًا"} />
        ) : free === 0 && event.fullPolicy === "CLOSE" ? (
          <ResultBox tone="err" icon="!" title="اكتمل العدد">
            <p>نعتذر، اكتملت المقاعد المتاحة لهذه الفعالية.</p>
          </ResultBox>
        ) : (
          <div className="card stack">
            <div className="row-between">
              <h2 style={{ margin: 0 }}>سجّل حضورك</h2>
              {free > 0 ? <span className="badge badge-ok">متبقٍ {free} مقعد</span> : <span className="badge badge-warn">قائمة انتظار</span>}
            </div>
            {free === 0 ? <div className="alert alert-warn">اكتمل العدد حاليًا. سجّل لتنضم إلى قائمة الانتظار، ونبلغك إذا توفر مقعد.</div> : null}
            <PublicForm slug={slug} idem={randomToken(12)} waitlist={free === 0} />
          </div>
        )}
      </div>
    </GuestShell>
  );
}
