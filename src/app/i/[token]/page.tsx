import Link from "next/link";
import { notFound } from "next/navigation";
import { invitationPage } from "@/services/queries";
import { eventView } from "@/services/presentation";
import { parsePalette } from "@/services/designs";
import { rsvpClosedReason } from "@/services/rsvp";
import { InvitationCard } from "@/components/InvitationCard";
import { GuestShell, ResultBox } from "@/components/GuestShell";
import { RsvpForm } from "./RsvpForm";

export const metadata = { title: "دعوة", robots: { index: false, follow: false } };

export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const inv = await invitationPage(token);
  if (!inv || inv.event.mode !== "PRIVATE") notFound();
  const event = inv.event;
  const view = eventView(event);
  const palette = parsePalette(event.template?.palette ?? "");
  const layout = event.template?.layout ?? "plum-frame";
  const closed = rsvpClosedReason(event);
  const reg = inv.registration;

  return (
    <GuestShell>
      <div className="stack">
        <InvitationCard layout={layout} palette={palette} view={view} mode="PRIVATE" guestName={inv.name} allowCompanion={inv.allowCompanion} />
        {view.mapUrl ? (
          <a className="btn btn-block" href={view.mapUrl} target="_blank" rel="noopener noreferrer">
            الموقع على الخريطة
          </a>
        ) : null}
        {sp.error ? (
          <div className="alert alert-err" role="alert">
            {sp.error}
          </div>
        ) : null}

        {closed === "NOT_ACTIVE" ? (
          <ResultBox tone="info" icon="⏳" title="الدعوة غير متاحة بعد">
            <p>لم يفعّل المنظّم هذه الدعوة بعد. حاول لاحقًا.</p>
          </ResultBox>
        ) : closed === "CANCELLED" ? (
          <ResultBox tone="err" icon="✕" title="أُلغيت الفعالية">
            <p>نعتذر، ألغى المنظّم هذه الفعالية.</p>
          </ResultBox>
        ) : closed === "ENDED" ? (
          <ResultBox tone="info" icon="✓" title="انتهت الفعالية">
            <p>انتهت فترة تأكيد الحضور لهذه الدعوة.</p>
          </ResultBox>
        ) : reg?.status === "CONFIRMED" ? (
          <ResultBox tone="ok" icon="✓" title="أكّدت حضورك">
            <p>تذكرتك جاهزة{reg.withCompanion ? " مع تذكرة مرافقك" : ""}.</p>
            <Link href={`/r/${reg.accessToken}`} className="btn btn-dark btn-lg btn-block">
              عرض التذكرة
            </Link>
          </ResultBox>
        ) : reg?.status === "WAITLISTED" || reg?.status === "OFFERED" ? (
          <ResultBox tone="warn" icon="⏳" title={reg.status === "OFFERED" ? "توفّر لك مقعد" : "أنت في قائمة الانتظار"}>
            <Link href={`/r/${reg.accessToken}`} className="btn btn-dark btn-block">
              {reg.status === "OFFERED" ? "أكّد حضورك الآن" : "عرض حالة الانتظار"}
            </Link>
          </ResultBox>
        ) : (
          <div className="card stack">
            {reg?.status === "DECLINED" || reg?.status === "CANCELLED" ? (
              <div className="alert alert-info">سجّلنا اعتذارك. إن تغيّرت ظروفك يمكنك تأكيد الحضور إذا كانت المقاعد متاحة.</div>
            ) : null}
            <h2 style={{ margin: 0 }}>تأكيد الحضور</h2>
            <RsvpForm
              token={inv.token}
              allowCompanion={inv.allowCompanion}
              fullPolicy={event.fullPolicy}
              defaults={{
                name: inv.name,
                contactMethod: inv.phone ? "WHATSAPP" : "EMAIL",
                phone: inv.phone ? "0" + inv.phone.replace(/^\+966/, "") : "",
                email: inv.email ?? "",
              }}
              showDecline={!reg}
            />
          </div>
        )}
      </div>
    </GuestShell>
  );
}
