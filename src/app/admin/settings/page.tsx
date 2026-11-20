import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { Flash, PageHeader, Badge, Money } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { savePlanAction, saveSettingsAction } from "@/app/actions/admin";

export const metadata = { title: "الباقات والتسعير" };

const sar = (h: number) => (h / 100).toString();

export default async function AdminSettings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const [plans, s] = await Promise.all([prisma.pricingPlan.findMany({ orderBy: { places: "asc" } }), getSettings()]);
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader title="الباقات والتسعير وإعدادات التشغيل" subtitle="القيم الحالية بيانات تجريبية للاختبار حتى تُعتمد الأسعار. كل تغيير يُسجّل في سجل التدقيق." />

      <section className="card stack">
        <h2>باقات الفعاليات</h2>
        <p className="small muted" style={{ margin: 0 }}>
          أول دفع يختار أصغر باقة مفعّلة تغطي العدد المطلوب. إن تجاوز العدد أكبر باقة تُضاف أماكن بسعر المكان الإضافي.
        </p>
        <div className="list">
          {plans.map((p) => (
            <form key={p.id} action={savePlanAction} className="list-item row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="planId" value={p.id} />
              <div className="field" style={{ flex: "2 1 160px" }}>
                <label htmlFor={`n-${p.id}`}>الاسم</label>
                <input id={`n-${p.id}`} name="name" className="input" defaultValue={p.name} required />
              </div>
              <div className="field" style={{ flex: "1 1 90px" }}>
                <label htmlFor={`pl-${p.id}`}>الأماكن</label>
                <input id={`pl-${p.id}`} name="places" type="number" className="input ltr-input" defaultValue={p.places} required />
              </div>
              <div className="field" style={{ flex: "1 1 110px" }}>
                <label htmlFor={`pr-${p.id}`}>السعر (ريال)</label>
                <input id={`pr-${p.id}`} name="price" className="input ltr-input" defaultValue={sar(p.price)} required />
              </div>
              <label className="check">
                <input type="checkbox" name="active" defaultChecked={p.active} /> مفعّلة
              </label>
              <label className="check">
                <input type="checkbox" name="isDemo" defaultChecked={p.isDemo} /> تجريبية
              </label>
              {p.isDemo ? <Badge tone="warn">سعر تجريبي</Badge> : <Badge tone="ok">معتمد</Badge>}
              <SubmitButton className="btn btn-sm btn-dark">حفظ</SubmitButton>
            </form>
          ))}
          <form action={savePlanAction} className="list-item row card-lilac" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: "2 1 160px" }}>
              <label htmlFor="n-new">باقة جديدة</label>
              <input id="n-new" name="name" className="input" placeholder="اسم الباقة" required />
            </div>
            <div className="field" style={{ flex: "1 1 90px" }}>
              <label htmlFor="pl-new">الأماكن</label>
              <input id="pl-new" name="places" type="number" className="input ltr-input" required />
            </div>
            <div className="field" style={{ flex: "1 1 110px" }}>
              <label htmlFor="pr-new">السعر (ريال)</label>
              <input id="pr-new" name="price" className="input ltr-input" required />
            </div>
            <input type="hidden" name="active" value="on" />
            <input type="hidden" name="isDemo" value="on" />
            <SubmitButton className="btn btn-sm btn-primary">إضافة</SubmitButton>
          </form>
        </div>
      </section>

      <form action={saveSettingsAction} className="card stack">
        <h2>تسعير الرسائل والأماكن الإضافية</h2>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="priceWhatsapp">رسالة واتساب من الرصيد (ريال)</label>
            <input id="priceWhatsapp" name="priceWhatsapp" className="input ltr-input" defaultValue={sar(s.messagePrice.WHATSAPP)} />
          </div>
          <div className="field">
            <label htmlFor="priceEmail">رسالة بريد من الرصيد (ريال)</label>
            <input id="priceEmail" name="priceEmail" className="input ltr-input" defaultValue={sar(s.messagePrice.EMAIL)} />
          </div>
          <div className="field">
            <label htmlFor="extraPlacePrice">سعر المكان الإضافي (ريال)</label>
            <input id="extraPlacePrice" name="extraPlacePrice" className="input ltr-input" defaultValue={sar(s.extraPlacePrice)} />
          </div>
          <div className="field">
            <label htmlFor="opWhatsapp">تكلفة تشغيل رسالة التأكيد — واتساب</label>
            <input id="opWhatsapp" name="opWhatsapp" className="input ltr-input" defaultValue={sar(s.confirmationOperatingCost.WHATSAPP)} />
            <span className="hint">تُحمّل على الباقة ولا تُخصم من رصيد المنظّم</span>
          </div>
          <div className="field">
            <label htmlFor="opEmail">تكلفة تشغيل رسالة التأكيد — البريد</label>
            <input id="opEmail" name="opEmail" className="input ltr-input" defaultValue={sar(s.confirmationOperatingCost.EMAIL)} />
          </div>
        </div>

        <h2>سياسات التشغيل</h2>
        <fieldset>
          <legend>عند عدم كفاية رصيد الرسائل</legend>
          <div className="choice-group">
            <label className="choice">
              <input type="radio" name="insufficientBalancePolicy" value="BLOCK" defaultChecked={s.insufficientBalancePolicy === "BLOCK"} />
              <span>
                <span className="t">منع الإرسال كاملًا (مقترح)</span>
                <span className="d">لا يُرسل ولا يُخصم شيء حتى يُشحن الرصيد. التذكير المجدول يفشل بسبب واضح.</span>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="insufficientBalancePolicy" value="SEND_AFFORDABLE" defaultChecked={s.insufficientBalancePolicy === "SEND_AFFORDABLE"} />
              <span>
                <span className="t">إرسال ما يغطيه الرصيد</span>
                <span className="d">يُرسل بترتيب القائمة حتى ينفد الرصيد، والباقي يبقى «لم تُرسل».</span>
              </span>
            </label>
          </div>
        </fieldset>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="maxSendAttempts">محاولات الإرسال قبل الفشل</label>
            <input id="maxSendAttempts" name="maxSendAttempts" type="number" className="input ltr-input" defaultValue={s.maxSendAttempts} />
          </div>
          <div className="field">
            <label htmlFor="retryBaseSeconds">مهلة إعادة المحاولة الأولى (ثانية)</label>
            <input id="retryBaseSeconds" name="retryBaseSeconds" type="number" className="input ltr-input" defaultValue={s.retryBaseSeconds} />
            <span className="hint">تتضاعف مع كل محاولة</span>
          </div>
          <div className="field">
            <label htmlFor="waitlistOfferHours">صلاحية فرصة الانتظار (ساعة)</label>
            <input id="waitlistOfferHours" name="waitlistOfferHours" type="number" className="input ltr-input" defaultValue={s.waitlistOfferHours} />
          </div>
          <div className="field">
            <label htmlFor="ticketResendCooldownMinutes">أقل مدة بين إعادة إرسال التذكرة (دقيقة)</label>
            <input
              id="ticketResendCooldownMinutes"
              name="ticketResendCooldownMinutes"
              type="number"
              className="input ltr-input"
              defaultValue={s.ticketResendCooldownMinutes}
            />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" name="refundOnFailure" defaultChecked={s.refundOnFailure} />
          <span>استرجاع قيمة الرسالة للرصيد تلقائيًا عند فشلها نهائيًا (مقترح)</span>
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          إعادة إرسال المنظّم لرسالة (مثلًا بعد تصحيح الرقم) تُحسب رسالة جديدة. رسالة تأكيد الحضور مع التذكرة مشمولة في الباقة دائمًا. القيم الحالية:
          واتساب <Money value={s.messagePrice.WHATSAPP} /> · بريد <Money value={s.messagePrice.EMAIL} /> · المكان الإضافي <Money value={s.extraPlacePrice} />.
        </p>
        <SubmitButton className="btn btn-primary">حفظ الإعدادات</SubmitButton>
      </form>
    </div>
  );
}
