import Link from "next/link";
import { notFound } from "next/navigation";
import { getRegistrationByAccessToken } from "@/services/rsvp";
import { links } from "@/services/presentation";
import { NotFoundError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { GuestShell, ResultBox } from "@/components/GuestShell";
import { TicketCard } from "@/components/TicketCard";
import { SubmitButton, ShareButton, CopyButton } from "@/components/client";
import { cancelByGuestAction } from "@/app/actions/guest";
import { OfferForm } from "./OfferForm";

export const metadata = { title: "تذكرتي", robots: { index: false, follow: false } };

export default async function RegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ accessToken: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ accessToken }, sp] = await Promise.all([params, searchParams]);
  let reg;
  try {
    reg = await getRegistrationByAccessToken(accessToken);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const event = reg.event;
  const attended = reg.tickets.some((t) => t.checkedInAt);
  const primary = reg.tickets.find((t) => t.kind === "PRIMARY");
  const companion = reg.tickets.find((t) => t.kind === "COMPANION");
  const allowCompanion = reg.invitation?.allowCompanion ?? false;

  return (
    <GuestShell>
      <div className="stack">
        {sp.error ? (
          <div className="alert alert-err" role="alert">
            {sp.error}
          </div>
        ) : null}

        {reg.status === "CONFIRMED" ? (
          <>
            <ResultBox tone="ok" icon="✓" title={sp.state === "CONFIRMED" || !sp.state ? "تم تأكيد حضورك" : "حضورك مؤكد"}>
              <p style={{ margin: 0 }}>
                {reg.name}، أرسلنا التذكرة إلى {reg.contactMethod === "WHATSAPP" ? "واتساب" : "بريدك"}
                {companion ? " مع تذكرة مرافقك" : ""}.
              </p>
            </ResultBox>
            {primary ? <TicketCard event={event} ticket={primary} primaryName={reg.name} /> : null}
            {companion ? (
              <div className="stack-sm">
                <div className="card-lilac stack-sm">
                  <strong>تذكرة المرافق</strong>
                  <p className="small" style={{ margin: 0 }}>
                    شاركها مع مرافقك. كل تذكرة تدخل بشكل مستقل، فيستطيع الدخول في وقت مختلف عنك.
                  </p>
                  <div className="row">
                    <ShareButton url={links.ticket(companion.code)} text={`تذكرة مرافق — ${event.title}`} label="مشاركة تذكرة المرافق" />
                    <CopyButton text={links.ticket(companion.code)} label="نسخ الرابط" className="btn" />
                  </div>
                </div>
                <TicketCard event={event} ticket={companion} primaryName={reg.name} />
              </div>
            ) : null}
            {!attended ? (
              <details className="box">
                <summary>لن أستطيع الحضور</summary>
                <p className="small muted">عند الاعتذار تُلغى {companion ? "التذكرتان" : "التذكرة"} ويتحرر المقعد لغيرك.</p>
                <form action={cancelByGuestAction}>
                  <input type="hidden" name="accessToken" value={accessToken} />
                  <SubmitButton className="btn btn-danger btn-block" confirm="تأكيد الاعتذار عن الحضور؟">
                    الاعتذار عن الحضور
                  </SubmitButton>
                </form>
              </details>
            ) : null}
          </>
        ) : reg.status === "OFFERED" ? (
          <div className="card stack">
            <ResultBox tone="ok" icon="★" title="توفّر لك مقعد">
              <p style={{ margin: 0 }}>
                أكّد حضورك {reg.offerExpiresAt ? `قبل ${formatDateTime(reg.offerExpiresAt, event.timezone)}` : "الآن"}. يُحجز المقعد عند التأكيد إذا كان لا
                يزال متاحًا.
              </p>
            </ResultBox>
            <OfferForm accessToken={accessToken} allowCompanion={allowCompanion && reg.seatsRequested >= 2} />
          </div>
        ) : reg.status === "WAITLISTED" ? (
          <ResultBox tone="warn" icon="⏳" title={sp.state === "OFFER_UNAVAILABLE" ? "المقعد لم يعد متاحًا" : sp.state === "OFFER_EXPIRED" ? "انتهت صلاحية الفرصة" : "أنت في قائمة الانتظار"}>
            <p style={{ margin: 0 }}>
              {sp.state === "OFFER_UNAVAILABLE"
                ? "حُجز المقعد قبل تأكيدك. ما زلت في قائمة الانتظار وسنبلغك إذا توفر مقعد آخر."
                : `اكتمل العدد حاليًا. سنرسل لك على ${reg.contactMethod === "WHATSAPP" ? "واتساب" : "البريد"} إذا توفر مقعد.`}
            </p>
          </ResultBox>
        ) : (
          <ResultBox tone="info" icon="✓" title="سجّلنا اعتذارك">
            <p style={{ margin: 0 }}>شكرًا لإبلاغنا.</p>
            {reg.invitation ? (
              <p className="small" style={{ marginTop: 8 }}>
                تغيّرت ظروفك؟ <Link href={`/i/${reg.invitation.token}`}>أكّد حضورك من صفحة الدعوة</Link>
              </p>
            ) : null}
          </ResultBox>
        )}
        {reg.status !== "CONFIRMED" && reg.status !== "OFFERED" && reg.status !== "WAITLISTED" ? null : (
          <p className="small muted" style={{ textAlign: "center" }}>
            احتفظ بهذا الرابط — يمكنك فتح تذكرتك منه في أي وقت.
          </p>
        )}
      </div>
    </GuestShell>
  );
}
