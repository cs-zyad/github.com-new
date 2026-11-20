import { qrSvg } from "@/services/tickets";
import { eventView, type EventLike } from "@/services/presentation";
import { shortRef } from "@/lib/ids";
import { formatDateTime } from "@/lib/format";
import { LogoMark } from "./Logo";

/** تذكرة الدخول — رمز QR الفعلي الصادر من النظام */
export async function TicketCard({
  event,
  ticket,
  primaryName,
}: {
  event: EventLike;
  ticket: { code: string; kind: string; holderName: string; checkedInAt: Date | null };
  primaryName: string;
}) {
  const v = eventView(event);
  const svg = await qrSvg(ticket.code);
  const isCompanion = ticket.kind === "COMPANION";
  return (
    <article className="ticket" aria-label={`تذكرة ${ticket.holderName}`}>
      <div className="ticket-head">
        <div className="row-between">
          <span className="kind">{isCompanion ? "تذكرة مرافق" : "تذكرة دخول"}</span>
          <LogoMark size={26} onDark />
        </div>
        <h2>{v.title}</h2>
        <div style={{ fontSize: 14, opacity: 0.85 }}>{v.whenText}</div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>{v.venueText}</div>
      </div>
      <div className="ticket-body">
        <div className="ticket-qr" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label="رمز QR للدخول" />
        <div className="ticket-holder">{isCompanion ? `مرافق — ${primaryName}` : ticket.holderName}</div>
        <div className="ticket-ref">
          مرجع: <bdi className="ltr">{shortRef(ticket.code)}</bdi>
        </div>
        {ticket.checkedInAt ? (
          <div className="alert alert-ok" style={{ marginTop: 12, textAlign: "center" }}>
            تم تسجيل الدخول {formatDateTime(ticket.checkedInAt, event.timezone)}
          </div>
        ) : (
          <p className="small muted" style={{ textAlign: "center", marginTop: 10, marginBottom: 0 }}>
            اعرض هذا الرمز لفريق الاستقبال عند الدخول. كل تذكرة لشخص واحد.
          </p>
        )}
      </div>
    </article>
  );
}
