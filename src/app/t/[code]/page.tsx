import { notFound } from "next/navigation";
import { ticketByCode } from "@/services/queries";
import { GuestShell, ResultBox } from "@/components/GuestShell";
import { TicketCard } from "@/components/TicketCard";

export const metadata = { title: "تذكرة الدخول", robots: { index: false, follow: false } };

/** صفحة تذكرة واحدة — تُستخدم لمشاركة تذكرة المرافق بشكل مستقل */
export default async function TicketPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^W1[A-Za-z0-9_-]{20,}$/.test(code)) notFound();
  const ticket = await ticketByCode(code);
  if (!ticket) notFound();
  const active = ticket.status === "ACTIVE" && ticket.registration.status === "CONFIRMED";
  return (
    <GuestShell>
      <div className="stack">
        {active ? (
          <TicketCard event={ticket.event} ticket={ticket} primaryName={ticket.registration.name} />
        ) : (
          <ResultBox tone="err" icon="✕" title="التذكرة غير صالحة">
            <p style={{ margin: 0 }}>أُلغيت هذه التذكرة. تواصل مع صاحب الدعوة.</p>
          </ResultBox>
        )}
      </div>
    </GuestShell>
  );
}
