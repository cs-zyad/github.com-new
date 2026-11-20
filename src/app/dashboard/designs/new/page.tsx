import { requireUser } from "@/lib/auth";
import { ownerEventOptions } from "@/services/queries";
import { Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createDesignRequestAction } from "@/app/actions/account";

export const metadata = { title: "طلب تصميم خاص" };

export default async function NewDesignPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const events = (await ownerEventOptions(user.id)).filter((e) => e.status === "DRAFT" || e.status === "ACTIVE");
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader title="طلب تصميم خاص" back={{ href: "/dashboard/designs", label: "طلبات التصميم" }} />
      <form action={createDesignRequestAction} className="card stack">
        <div className="field">
          <label htmlFor="title">عنوان الطلب</label>
          <input id="title" name="title" className="input" required minLength={3} placeholder="مثال: دعوة حفل تخرج بهوية الجامعة" />
        </div>
        <div className="field">
          <label htmlFor="details">التفاصيل</label>
          <textarea id="details" name="details" className="textarea" required minLength={10} placeholder="الألوان، الشعار، النصوص المطلوبة، المقاسات، الموعد المطلوب…" />
        </div>
        <div className="field">
          <label htmlFor="referenceUrl">رابط مرجعي (اختياري)</label>
          <input id="referenceUrl" name="referenceUrl" type="url" className="input ltr-input" placeholder="https://" />
          <span className="hint">رابط لملف الهوية أو أمثلة تعجبك (Drive أو غيره).</span>
        </div>
        <div className="field">
          <label htmlFor="eventId">الفعالية المرتبطة (اختياري)</label>
          <select id="eventId" name="eventId" className="select" defaultValue="">
            <option value="">بدون</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-primary">إرسال الطلب</SubmitButton>
      </form>
    </div>
  );
}
