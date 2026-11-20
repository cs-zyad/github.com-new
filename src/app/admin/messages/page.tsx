import { adminMessages } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { messageKindLabel, messageStatusLabel, channelLabel, billingLabel } from "@/lib/labels";
import { PageHeader, Badge, Money, Stat } from "@/components/ui";

export const metadata = { title: "الرسائل والتكلفة" };

export default async function AdminMessages() {
  const { byBilling, st, recent } = await adminMessages();
  const walletRevenue = byBilling.filter((b) => b.billing === "WALLET").reduce((s, b) => s + b.cost, 0);
  const packageCost = byBilling.filter((b) => b.billing === "PACKAGE").reduce((s, b) => s + b.operatingCost, 0);
  return (
    <div className="stack">
      <PageHeader
        title="الرسائل والتكلفة"
        subtitle="عزل محاسبي: رسائل الدعوات والتذكيرات تُخصم من رصيد المنظّم، ورسائل تأكيد الحضور مع التذكرة تُحمّل على تكلفة تشغيل الباقة."
      />
      <div className="grid-stats">
        <Stat label="مُرسلة" value={st.SENT ?? 0} />
        <Stat label="فاشلة" value={st.FAILED ?? 0} />
        <Stat label="في الطابور" value={(st.QUEUED ?? 0) + (st.SENDING ?? 0)} />
        <Stat label="إيراد رصيد الرسائل" value={<Money value={walletRevenue} />} highlight />
        <Stat label="تكلفة تشغيل التأكيدات (الباقات)" value={<Money value={packageCost} />} hint="تقديرية" />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>جهة التحميل</th>
              <th>القناة</th>
              <th className="num">عدد المرسلة</th>
              <th className="num">المخصوم من الرصيد</th>
              <th className="num">تكلفة التشغيل</th>
            </tr>
          </thead>
          <tbody>
            {byBilling.map((b) => (
              <tr key={`${b.billing}-${b.channel}`}>
                <td>{billingLabel[b.billing]}</td>
                <td>{channelLabel[b.channel]}</td>
                <td className="num">{b.count}</td>
                <td className="num">
                  <Money value={b.cost} />
                </td>
                <td className="num">
                  <Money value={b.operatingCost} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>آخر الرسائل</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>المنظّم</th>
              <th>النوع</th>
              <th>القناة</th>
              <th>الحالة</th>
              <th>التحميل</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">{formatDateTime(m.createdAt)}</td>
                <td>{m.owner.name}</td>
                <td>{messageKindLabel[m.kind]}</td>
                <td>{channelLabel[m.channel]}</td>
                <td>
                  <Badge tone={m.status === "SENT" ? "ok" : m.status === "FAILED" ? "err" : "warn"}>{messageStatusLabel[m.status]}</Badge>
                </td>
                <td className="small">{billingLabel[m.billing]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
