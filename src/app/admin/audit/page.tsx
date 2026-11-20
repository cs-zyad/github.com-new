import { adminAudit } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "سجل التدقيق" };

export default async function AdminAudit() {
  const logs = await adminAudit();
  return (
    <div className="stack">
      <PageHeader title="سجل التدقيق" subtitle="العمليات الإدارية والمهمة: الدفع، الإعدادات، الصلاحيات، الإلغاءات، التسويات." />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>المنفّذ</th>
              <th>العملية</th>
              <th>العنصر</th>
              <th>تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{formatDateTime(l.createdAt)}</td>
                <td>{l.actor?.name ?? "النظام"}</td>
                <td className="mono small">{l.action}</td>
                <td className="small">
                  {l.entityType} <span className="mono">{l.entityId?.slice(-8)}</span>
                </td>
                <td className="mono small" style={{ maxWidth: 380, overflowWrap: "anywhere" }}>
                  {l.meta !== "{}" ? l.meta.slice(0, 300) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
