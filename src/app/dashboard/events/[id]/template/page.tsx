import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOwnedEvent } from "@/services/events";
import { templatesForOrganizer, parsePalette } from "@/services/designs";
import { eventView } from "@/services/presentation";
import { composeInvitation, composeConfirmation } from "@/services/compose";
import { InvitationCard } from "@/components/InvitationCard";
import { Flash, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { chooseTemplateAction } from "@/app/actions/events";
import { templateCategoryLabel } from "@/lib/labels";

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  const templates = await templatesForOrganizer(user.id);
  const view = eventView(event);
  const selected = templates.find((t) => t.id === event.templateId) ?? null;
  const sampleName = "سارة العتيبي";
  const inviteMsg =
    event.mode === "PRIVATE"
      ? composeInvitation(event, { name: sampleName, token: "مثال-رابط-الدعوة", allowCompanion: false }, "INVITATION")
      : null;
  const confirmMsg = composeConfirmation(event, { name: sampleName, accessToken: "مثال" }, [{ kind: "PRIMARY", code: "W1مثال-رمز-التذكرة" }]);

  return (
    <div className="stack">
      <Flash sp={sp} />
      <section className="stack-sm">
        <div className="row-between">
          <h2 style={{ margin: 0 }}>اختر القالب</h2>
          <Link href="/dashboard/designs/new" className="small">
            تحتاج تصميمًا خاصًا؟ اطلبه من هنا
          </Link>
        </div>
        <p className="muted small">التصميم ثابت لكل قالب، والبيانات تُعبّأ تلقائيًا من بيانات فعاليتك.</p>
        <div className="grid-3">
          {templates.map((t) => (
            <div key={t.id} className="card-flat stack-sm" style={t.id === event.templateId ? { borderColor: "var(--plum)", borderWidth: 2 } : undefined}>
              <div style={{ transform: "scale(1)", pointerEvents: "none" }}>
                <InvitationCard layout={t.layout} palette={parsePalette(t.palette)} view={view} mode={event.mode} guestName={event.mode === "PRIVATE" ? sampleName : null} />
              </div>
              <div className="row-between">
                <div>
                  <strong>{t.name}</strong>{" "}
                  {t.visibility === "PRIVATE" ? <Badge tone="ok">تصميمك الخاص</Badge> : <Badge tone="neutral">{templateCategoryLabel[t.category] ?? t.category}</Badge>}
                </div>
                {t.id === event.templateId ? (
                  <Badge tone="att">المختار</Badge>
                ) : (
                  <form action={chooseTemplateAction}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="templateId" value={t.id} />
                    <SubmitButton className="btn btn-sm btn-dark">اختيار</SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="card stack" id="preview">
          <div className="card-head">
            <h2>المعاينة قبل الدفع والإرسال</h2>
            <Link href={`/dashboard/events/${event.id}/billing`} className="btn btn-primary">
              متابعة إلى الباقة والدفع
            </Link>
          </div>
          <div className="grid-2">
            <div className="stack-sm">
              <h3>صفحة الدعوة كما يراها الضيف</h3>
              <div style={{ maxWidth: 420 }}>
                <InvitationCard
                  layout={selected.layout}
                  palette={parsePalette(selected.palette)}
                  view={view}
                  mode={event.mode}
                  guestName={event.mode === "PRIVATE" ? sampleName : null}
                />
              </div>
            </div>
            <div className="stack-sm">
              {inviteMsg ? (
                <>
                  <h3>رسالة الدعوة (واتساب)</h3>
                  <div className="msg-preview">{inviteMsg.body}</div>
                  <h3>رسالة الدعوة (البريد)</h3>
                  <div className="msg-preview email">
                    <strong>{inviteMsg.subject}</strong>
                    {"\n\n"}
                    {inviteMsg.body}
                  </div>
                </>
              ) : null}
              <h3>رسالة تأكيد الحضور مع التذكرة</h3>
              <div className="msg-preview">{confirmMsg.body}</div>
              <p className="small muted">الأسماء والروابط هنا مثال. البيانات نفسها تظهر في الصفحة والقالب والرسالة.</p>
            </div>
          </div>
        </section>
      ) : (
        <div className="alert alert-info">اختر قالبًا لعرض المعاينة.</div>
      )}
    </div>
  );
}
