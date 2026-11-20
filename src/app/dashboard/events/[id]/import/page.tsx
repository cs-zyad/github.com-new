import { requireUser } from "@/lib/auth";
import { getOwnedEvent } from "@/services/events";
import { ImportClient } from "./ImportClient";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  if (event.mode !== "PRIVATE") return <div className="alert alert-info">الاستيراد متاح للدعوات الخاصة فقط.</div>;
  return (
    <div className="stack">
      <div>
        <h2>استيراد المدعوين من Excel</h2>
        <p className="muted small">
          الأعمدة المقبولة: <strong>الاسم</strong>، <strong>الجوال</strong>، <strong>البريد الإلكتروني</strong>، <strong>مرافق</strong> (نعم/لا).
          يكفي الجوال أو البريد لكل مدعو. الصيغ المقبولة: ‎.xlsx‎ و ‎.csv‎ —{" "}
          <a href="/api/import/template">تنزيل ملف نموذجي</a>
        </p>
      </div>
      <ImportClient eventId={event.id} />
    </div>
  );
}
