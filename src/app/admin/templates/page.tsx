import { adminTemplates } from "@/services/queries";
import { parsePalette } from "@/services/designs";
import { eventView } from "@/services/presentation";
import { brand } from "@/config/brand";
import { templateCategoryLabel } from "@/lib/labels";
import { InvitationCard } from "@/components/InvitationCard";
import { LayoutSelect, PaletteFields } from "@/components/PaletteFields";
import { Flash, PageHeader, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createTemplateAction, updateTemplateAction } from "@/app/actions/admin";

export const metadata = { title: "القوالب" };

const sampleView = eventView({
  id: "sample",
  title: "ملتقى الابتكار السنوي",
  hostName: "جهة منظّمة",
  description: "",
  startsAt: new Date("2026-12-15T16:00:00Z"),
  endsAt: null,
  timezone: "Asia/Riyadh",
  venueName: "القاعة الكبرى",
  venueAddress: "الرياض",
  mapUrl: null,
  mode: "PRIVATE",
});

const defaultPalette = {
  primary: brand.colors.plum,
  accent: brand.colors.lime,
  background: brand.colors.ivory,
  text: brand.colors.plum,
  muted: brand.colors.muted,
};

function CategorySelect({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>التصنيف</label>
      <select id={id} name="category" className="select" defaultValue={defaultValue ?? "GENERAL"}>
        {Object.entries(templateCategoryLabel).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

export default async function AdminTemplates({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const templates = await adminTemplates();
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader title="القوالب" subtitle="القوالب العامة متاحة لكل المنظّمين، والخاصة تُسلّم من طلبات التصميم لمنظّم واحد." />

      <details className="box">
        <summary>+ قالب عام جديد</summary>
        <form action={createTemplateAction} className="stack-sm" style={{ marginTop: 10 }}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="new-name">الاسم</label>
              <input id="new-name" name="name" className="input" required />
            </div>
            <LayoutSelect id="new-layout" />
            <CategorySelect id="new-cat" />
            <div className="field">
              <label htmlFor="new-sort">الترتيب</label>
              <input id="new-sort" name="sortOrder" type="number" className="input ltr-input" defaultValue={100} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="new-desc">الوصف</label>
            <input id="new-desc" name="description" className="input" />
          </div>
          <PaletteFields p={defaultPalette} idPrefix="new" />
          <SubmitButton className="btn btn-primary">إضافة القالب</SubmitButton>
        </form>
      </details>

      <div className="grid-2">
        {templates.map((t) => {
          const p = parsePalette(t.palette);
          return (
            <div key={t.id} className="card stack-sm">
              <div className="row-between">
                <strong>{t.name}</strong>
                <span className="row" style={{ gap: 4 }}>
                  <Badge tone={t.status === "ACTIVE" ? "ok" : "neutral"}>{t.status === "ACTIVE" ? "ظاهر" : "مخفي"}</Badge>
                  <Badge tone={t.visibility === "PUBLIC" ? "info" : "warn"}>{t.visibility === "PUBLIC" ? "عام" : `خاص: ${t.owner?.name ?? ""}`}</Badge>
                </span>
              </div>
              <div style={{ maxWidth: 360 }}>
                <InvitationCard layout={t.layout} palette={p} view={sampleView} mode="PRIVATE" guestName="اسم المدعو" />
              </div>
              <div className="small muted">مستخدم في {t._count.events} فعالية</div>
              <details>
                <summary className="btn btn-sm">تعديل</summary>
                <form action={updateTemplateAction} className="stack-sm card-flat" style={{ marginTop: 8 }}>
                  <input type="hidden" name="templateId" value={t.id} />
                  <div className="field">
                    <label htmlFor={`${t.id}-name`}>الاسم</label>
                    <input id={`${t.id}-name`} name="name" className="input" defaultValue={t.name} required />
                  </div>
                  <div className="grid-2">
                    <LayoutSelect id={`${t.id}-layout`} defaultValue={t.layout} />
                    <CategorySelect id={`${t.id}-cat`} defaultValue={t.category} />
                    <div className="field">
                      <label htmlFor={`${t.id}-status`}>الحالة</label>
                      <select id={`${t.id}-status`} name="status" className="select" defaultValue={t.status}>
                        <option value="ACTIVE">ظاهر للمنظّمين</option>
                        <option value="HIDDEN">مخفي</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`${t.id}-sort`}>الترتيب</label>
                      <input id={`${t.id}-sort`} name="sortOrder" type="number" className="input ltr-input" defaultValue={t.sortOrder} />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor={`${t.id}-desc`}>الوصف</label>
                    <input id={`${t.id}-desc`} name="description" className="input" defaultValue={t.description} />
                  </div>
                  <PaletteFields p={p} idPrefix={t.id} />
                  <SubmitButton className="btn btn-sm btn-primary">حفظ</SubmitButton>
                </form>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
