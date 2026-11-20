import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOwnedEvent } from "@/services/events";
import { formatDateTime } from "@/lib/format";
import { messageKindLabel, messageStatusLabel, channelLabel, billingLabel } from "@/lib/labels";
import { displayPhone } from "@/lib/contact";
import { Badge, Money, Empty } from "@/components/ui";

export default async function EventMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  const messages = await prisma.message.findMany({
    where: { eventId: event.id, kind: { not: "STAFF_INVITE" } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return (
    <div className="stack">
      <h2>سجل الرسائل</h2>
      <p className="small muted">كل عملية إرسال بالقناة والوقت والحالة وجهة التحميل (رصيد الرسائل أو ضمن الباقة).</p>
      {messages.length === 0 ? (
        <Empty>لا توجد رسائل بعد.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>النوع</th>
                <th>القناة</th>
                <th>المستلم</th>
                <th>الحالة</th>
                <th>المحاولات</th>
                <th>التحميل</th>
                <th className="num">التكلفة</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{formatDateTime(m.sentAt ?? m.createdAt, event.timezone)}</td>
                  <td>{messageKindLabel[m.kind]}</td>
                  <td>{channelLabel[m.channel]}</td>
                  <td>
                    <bdi className="ltr">{m.channel === "WHATSAPP" ? displayPhone(m.recipient) : m.recipient}</bdi>
                  </td>
                  <td>
                    <Badge tone={m.status === "SENT" ? "ok" : m.status === "FAILED" ? "err" : "warn"}>{messageStatusLabel[m.status]}</Badge>
                    {m.lastError && m.status !== "SENT" ? <div className="small muted">{m.lastError}</div> : null}
                  </td>
                  <td className="num">{m.attempts}</td>
                  <td className="small">
                    {billingLabel[m.billing]}
                    {m.refunded ? " · استُرجع" : ""}
                  </td>
                  <td className="num">
                    <Money value={m.cost} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
