import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { messageKindLabel, messageStatusLabel, channelLabel, billingLabel } from "@/lib/labels";
import { PageHeader, Badge, Money, Stat } from "@/components/ui";

export const metadata = { title: "الرسائل والتكلفة" };

export default async function AdminMessages() {
  const [byBilling, byStatus, recent] = await Promise.all([
    prisma.message.groupBy({ by: ["billing", "channel"], where: { status: "SENT" }, _count: { _all: true }, _sum: { cost: true, operatingCost: true } }),
    prisma.message.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.message.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { owner: { select: { name: true } } } }),
  ]);
  const st = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  const walletRevenue = byBilling.filter((b) => b.billing === "WALLET").reduce((s, b) => s + (b._sum.cost ?? 0), 0);
  const packageCost = byBilling.filter((b) => b.billing === "PACKAGE").reduce((s, b) => s + (b._sum.operatingCost ?? 0), 0);
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
                <td className="num">{b._count._all}</td>
                <td className="num">
                  <Money value={b._sum.cost ?? 0} />
                </td>
                <td className="num">
                  <Money value={b._sum.operatingCost ?? 0} />
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
