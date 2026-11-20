import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { eventPayments, invitationCounts } from "@/services/queries";
import { getOwnedEvent, requiredPlaces } from "@/services/events";
import { quotePackage } from "@/services/pricing";
import { links } from "@/services/presentation";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { paymentPurposeLabel, paymentStatusLabel } from "@/lib/labels";
import { Flash, Money, Badge, Stat } from "@/components/ui";
import { SubmitButton, CopyField, ShareButton } from "@/components/client";
import { packageCheckoutAction, extraPlacesCheckoutAction } from "@/app/actions/events";

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  const settings = await getSettings();
  const [needed, payments] = await Promise.all([
    requiredPlaces(event),
    eventPayments(event.id),
  ]);
  let quote: Awaited<ReturnType<typeof quotePackage>> | null = null;
  let quoteError: string | null = null;
  try {
    quote = await quotePackage(event);
  } catch (e) {
    quoteError = e instanceof Error ? e.message : "تعذّر حساب الباقة";
  }
  const isPrivate = event.mode === "PRIVATE";
  const counts = isPrivate ? await invitationCounts(event.id) : { total: 0, withCompanion: 0 };
  const withCompanion = counts.withCompanion;
  const invitations = counts.total;
  const blocked = !event.templateId ? "اختر القالب وراجع المعاينة أولًا" : isPrivate && invitations === 0 ? "أضف المدعوين أولًا" : null;

  return (
    <div className="stack">
      <Flash sp={sp} />

      {event.mode === "PUBLIC" && event.publicSlug ? (
        <div className="card-plum stack-sm">
          <strong style={{ color: "var(--lime)" }}>الرابط العام جاهز للمشاركة</strong>
          <CopyField text={links.publicEvent(event.publicSlug)} />
          <div className="row">
            <ShareButton url={links.publicEvent(event.publicSlug)} text={event.title} label="مشاركة الرابط" />
            <Link href={`/e/${event.publicSlug}`} className="btn btn-primary" target="_blank">
              فتح صفحة التسجيل
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid-stats">
        <Stat label="الأماكن المطلوبة" value={needed} hint={isPrivate ? `${invitations} دعوة + ${withCompanion} مرافق مسموح` : "الحد الأقصى للحضور"} />
        <Stat label="أماكن الباقة المدفوعة" value={event.paidPlaces} highlight />
        <Stat label="المقاعد المحجوزة فعليًا" value={event.reservedSeats} hint="من الضيوف المؤكدين" />
      </div>

      {quoteError ? <div className="alert alert-err">{quoteError}</div> : null}

      {quote && quote.kind !== "NONE" ? (
        <div className="card stack">
          <h2>{quote.kind === "PACKAGE" ? "ملخص الباقة والتكلفة" : "أماكن إضافية مطلوبة"}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {isPrivate
              ? "الباقة تُحسب حسب عدد المدعوين، مع مكان إضافي لكل دعوة تسمح بمرافق. تدفع قبل إرسال الدعوات."
              : "الباقة تُحسب حسب الحد الأقصى للحضور. تدفع قبل نشر الرابط العام."}
          </p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {quote.breakdown.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td className="num">
                      <Money value={b.amount} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>الإجمالي</strong>
                  </td>
                  <td className="num">
                    <strong>
                      <Money value={quote.amount} />
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            يضيف الدفع {quote.places} مكانًا. رسائل الدعوات والتذكيرات تُخصم من رصيد الرسائل بشكل منفصل، ورسالة تأكيد الحضور مع التذكرة مشمولة في
            الباقة.
          </p>
          {blocked ? <div className="alert alert-warn">{blocked}</div> : null}
          <form action={packageCheckoutAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <SubmitButton className="btn btn-primary btn-lg" disabled={!!blocked || event.status === "CANCELLED"}>
              {quote.kind === "PACKAGE" ? (isPrivate ? "ادفع الباقة" : "ادفع وانشر الرابط") : `اشترِ ${quote.places} مكانًا إضافيًا`}
            </SubmitButton>
          </form>
        </div>
      ) : null}

      {event.paidPlaces > 0 && event.status === "ACTIVE" ? (
        <div className="card stack-sm">
          <h3>شراء أماكن إضافية</h3>
          <p className="small muted" style={{ margin: 0 }}>
            سعر المكان الإضافي <Money value={settings.extraPlacePrice} />.{" "}
            {isPrivate ? "تحتاجها عند إضافة مدعوين يتجاوزون الباقة." : "ترفع الحد الأقصى للحضور بنفس العدد."}
          </p>
          <form action={extraPlacesCheckoutAction} className="row">
            <input type="hidden" name="eventId" value={event.id} />
            <label htmlFor="places" className="sr-only">
              عدد الأماكن
            </label>
            <input id="places" name="places" type="number" min={1} max={10000} defaultValue={10} className="input ltr-input" style={{ width: 120 }} />
            <SubmitButton className="btn btn-dark">متابعة للدفع</SubmitButton>
          </form>
        </div>
      ) : null}

      <section className="stack-sm">
        <h2>مدفوعات الفعالية</h2>
        {payments.length === 0 ? (
          <p className="muted small">لا توجد مدفوعات بعد.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الغرض</th>
                  <th className="num">الأماكن</th>
                  <th className="num">المبلغ</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{formatDateTime(p.createdAt, event.timezone)}</td>
                    <td>{paymentPurposeLabel[p.purpose]}</td>
                    <td className="num">{p.places}</td>
                    <td className="num">
                      <Money value={p.amount} />
                    </td>
                    <td>
                      <Badge tone={p.status === "PAID" ? "ok" : p.status === "PENDING" ? "warn" : "neutral"}>{paymentStatusLabel[p.status]}</Badge>
                    </td>
                    <td>
                      {p.status === "PENDING" && p.provider === "mock" ? (
                        <Link href={`/dev/checkout/${p.id}`} className="btn btn-sm">
                          إكمال الدفع
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">تثبيت الدفع وزيادة الأماكن يتم فقط بعد تأكيد موثوق من مزوّد الدفع إلى الخادم.</p>
      </section>
    </div>
  );
}
