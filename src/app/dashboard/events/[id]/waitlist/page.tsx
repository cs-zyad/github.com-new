import { requireUser } from "@/lib/auth";
import { waitlistFor } from "@/services/queries";
import { randomToken } from "@/lib/ids";
import { getOwnedEvent, availableSeats } from "@/services/events";
import { getSettings } from "@/lib/settings";
import { displayPhone } from "@/lib/contact";
import { formatDateTime } from "@/lib/format";
import { Flash, RsvpBadge, Empty, Money } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { offerWaitlistAction } from "@/app/actions/events";

export default async function WaitlistPage({
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
  const list = await waitlistFor(event.id);
  const free = availableSeats(event);

  return (
    <div className="stack">
      <Flash sp={sp} />
      {event.fullPolicy !== "WAITLIST" ? (
        <div className="alert alert-info">سياسة هذه الفعالية «إغلاق التسجيل عند اكتمال العدد». يمكنك تغييرها من صفحة البيانات.</div>
      ) : null}
      <div className="grid-3">
        <div className="stat highlight">
          <div className="label">المقاعد المتاحة الآن</div>
          <div className="value">{free}</div>
        </div>
        <div className="stat">
          <div className="label">في قائمة الانتظار</div>
          <div className="value">{list.filter((r) => r.status === "WAITLISTED").length}</div>
        </div>
        <div className="stat">
          <div className="label">أُرسلت لهم فرصة</div>
          <div className="value">{list.filter((r) => r.status === "OFFERED").length}</div>
        </div>
      </div>
      <p className="small muted">
        عند توفر مقعد (مثلًا بعد اعتذار ضيف) اختر شخصًا وأرسل له فرصة التأكيد. يُحجز المقعد عندما يؤكد الشخص ويكون المقعد لا يزال متاحًا. صلاحية
        الفرصة {settings.waitlistOfferHours} ساعة. تكلفة الرسالة تُخصم من رصيد الرسائل (واتساب <Money value={settings.messagePrice.WHATSAPP} /> · بريد{" "}
        <Money value={settings.messagePrice.EMAIL} />
        ).
      </p>
      {list.length === 0 ? (
        <Empty>قائمة الانتظار فارغة.</Empty>
      ) : (
        <div className="list">
          {list.map((r, i) => (
            <div key={r.id} className="list-item row-between">
              <div>
                <div className="title">
                  {i + 1}. {r.name} <RsvpBadge status={r.status} />
                </div>
                <div className="small muted">
                  {r.phone ? <bdi className="ltr">{displayPhone(r.phone)}</bdi> : <bdi className="ltr">{r.email}</bdi>} · يطلب {r.seatsRequested} مقعد ·
                  انضم {formatDateTime(r.createdAt, event.timezone)}
                  {r.status === "OFFERED" && r.offerExpiresAt ? ` · تنتهي الفرصة ${formatDateTime(r.offerExpiresAt, event.timezone)}` : ""}
                </div>
              </div>
              {r.status === "WAITLISTED" ? (
                <form action={offerWaitlistAction}>
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="registrationId" value={r.id} />
                  <input type="hidden" name="batchKey" value={randomToken(10)} />
                  <SubmitButton className="btn btn-sm btn-primary" disabled={free < 1}>
                    أرسل فرصة التأكيد
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
