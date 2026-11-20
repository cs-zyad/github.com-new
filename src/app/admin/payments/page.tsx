import { adminPayments } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { paymentPurposeLabel, paymentStatusLabel } from "@/lib/labels";
import { PageHeader, Badge, Money } from "@/components/ui";

export const metadata = { title: "المدفوعات" };

export default async function AdminPayments() {
  const { payments, events } = await adminPayments();
  return (
    <div className="stack">
      <PageHeader title="المدفوعات" subtitle="العمليات وإشعارات المزوّد. كل إشعار يُعالج مرة واحدة حسب معرّفه." />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المنظّم</th>
              <th>الغرض</th>
              <th>الوصف</th>
              <th className="num">الأماكن</th>
              <th className="num">المبلغ</th>
              <th>الحالة</th>
              <th>المزوّد</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="nowrap">{formatDateTime(p.createdAt)}</td>
                <td>{p.owner.name}</td>
                <td>{paymentPurposeLabel[p.purpose]}</td>
                <td className="small">{p.description}</td>
                <td className="num">{p.places || ""}</td>
                <td className="num">
                  <Money value={p.amount} />
                </td>
                <td>
                  <Badge tone={p.status === "PAID" ? "ok" : p.status === "PENDING" ? "warn" : "neutral"}>{paymentStatusLabel[p.status]}</Badge>
                </td>
                <td className="small ltr">{p.provider}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>آخر إشعارات المزوّد</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>معرّف الإشعار</th>
              <th>النوع</th>
              <th>النتيجة</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{formatDateTime(e.receivedAt)}</td>
                <td className="mono small">{e.providerEventId}</td>
                <td className="mono small">{e.type}</td>
                <td>
                  <Badge tone={e.outcome === "PROCESSED" ? "ok" : e.outcome === "REJECTED" ? "err" : "neutral"}>{e.outcome}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
