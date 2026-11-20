import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOwnedEvent } from "@/services/events";
import { links } from "@/services/presentation";
import { displayPhone } from "@/lib/contact";
import { formatShortDateTime } from "@/lib/format";
import { channelLabel, checkInMethodLabel } from "@/lib/labels";
import { Flash, DeliveryBadge, RsvpBadge, Badge, Empty } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import {
  addInvitationAction,
  updateInvitationAction,
  deleteInvitationAction,
  setChannelAllAction,
  cancelRegistrationAction,
  resendTicketAction,
} from "@/app/actions/events";

const PRIVATE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "not_confirmed", label: "لم يؤكد" },
  { key: "confirmed", label: "مؤكد" },
  { key: "attended", label: "حضر" },
  { key: "failed", label: "تعذّر الإرسال" },
  { key: "not_sent", label: "لم تُرسل" },
  { key: "declined", label: "اعتذر" },
];

const PUBLIC_FILTERS = [
  { key: "all", label: "الكل" },
  { key: "confirmed", label: "مؤكد" },
  { key: "attended", label: "حضر" },
  { key: "waitlist", label: "الانتظار" },
  { key: "declined", label: "ألغى" },
];

type TicketLite = { kind: string; checkedInAt: Date | null; checkInMethod: string | null; status: string };

function Attendance({ tickets, tz }: { tickets: TicketLite[]; tz: string }) {
  const active = tickets.filter((t) => t.status === "ACTIVE");
  if (!active.length) return null;
  return (
    <div className="row small" style={{ gap: "0.35rem 0.75rem" }}>
      {active.map((t) => (
        <span key={t.kind}>
          {t.kind === "COMPANION" ? "المرافق: " : "الضيف: "}
          {t.checkedInAt ? (
            <Badge tone="att">
              حضر {formatShortDateTime(t.checkedInAt, tz)} · {checkInMethodLabel[t.checkInMethod ?? "SCAN"]}
            </Badge>
          ) : (
            <Badge tone="neutral">لم يحضر بعد</Badge>
          )}
        </span>
      ))}
    </div>
  );
}

export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  const filter = sp.filter ?? "all";
  const q = (sp.q ?? "").trim();
  const base = `/dashboard/events/${event.id}/guests`;
  const editable = event.status !== "CANCELLED" && event.status !== "ENDED";

  if (event.mode === "PUBLIC") {
    const where: Prisma.RegistrationWhereInput = { eventId: event.id };
    if (filter === "confirmed") where.status = "CONFIRMED";
    if (filter === "waitlist") where.status = { in: ["WAITLISTED", "OFFERED"] };
    if (filter === "declined") where.status = { in: ["CANCELLED", "DECLINED"] };
    if (filter === "attended") where.tickets = { some: { checkedInAt: { not: null } } };
    if (q) where.OR = [{ name: { contains: q } }, { phone: { contains: q.replace(/^0/, "") } }, { email: { contains: q.toLowerCase() } }];
    const regs = await prisma.registration.findMany({ where, orderBy: { createdAt: "desc" }, include: { tickets: true }, take: 500 });
    return (
      <div className="stack">
        <Flash sp={sp} />
        <Filters filters={PUBLIC_FILTERS} active={filter} base={base} q={q} />
        {regs.length === 0 ? (
          <Empty>لا يوجد مسجلون في هذا التصنيف.</Empty>
        ) : (
          <div className="list">
            {regs.map((r) => (
              <div key={r.id} className="list-item stack-sm">
                <div className="row-between">
                  <span className="title">{r.name}</span>
                  <RsvpBadge status={r.status} />
                </div>
                <div className="small muted">
                  {r.phone ? <bdi className="ltr">{displayPhone(r.phone)}</bdi> : <bdi className="ltr">{r.email}</bdi>} · عبر{" "}
                  {channelLabel[r.contactMethod]} · سُجّل {formatShortDateTime(r.createdAt, event.timezone)}
                </div>
                <Attendance tickets={r.tickets} tz={event.timezone} />
                {r.status === "CONFIRMED" ? (
                  <div className="row">
                    <form action={resendTicketAction}>
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="registrationId" value={r.id} />
                      <SubmitButton className="btn btn-sm">إعادة إرسال التذكرة</SubmitButton>
                    </form>
                    <form action={cancelRegistrationAction}>
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="registrationId" value={r.id} />
                      <SubmitButton className="btn btn-sm btn-danger" confirm={`إلغاء تسجيل ${r.name}؟ ستُلغى تذكرته ويتحرر مقعده.`}>
                        إلغاء التسجيل
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ───── الدعوات الخاصة ─────
  const where: Prisma.InvitationWhereInput = { eventId: event.id };
  if (filter === "not_confirmed") where.registration = null;
  if (filter === "confirmed") where.registration = { status: "CONFIRMED" };
  if (filter === "declined") where.registration = { status: { in: ["DECLINED", "CANCELLED"] } };
  if (filter === "attended") where.registration = { tickets: { some: { checkedInAt: { not: null } } } };
  if (filter === "failed") where.deliveryStatus = "FAILED";
  if (filter === "not_sent") where.deliveryStatus = "NOT_SENT";
  if (q) where.OR = [{ name: { contains: q } }, { phone: { contains: q.replace(/^0/, "") } }, { email: { contains: q.toLowerCase() } }];

  const [invitations, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: { registration: { include: { tickets: true } } },
      take: 1000,
    }),
    prisma.invitation.count({ where: { eventId: event.id } }),
  ]);

  return (
    <div className="stack">
      <Flash sp={sp} />
      {editable ? (
        <div className="grid-2">
          <details className="box" open={total === 0}>
            <summary>+ إضافة مدعو يدويًا</summary>
            <form action={addInvitationAction} className="stack-sm" style={{ marginTop: "0.75rem" }}>
              <input type="hidden" name="eventId" value={event.id} />
              <InviteFields />
              <SubmitButton className="btn btn-primary">إضافة</SubmitButton>
            </form>
          </details>
          <div className="box card-flat stack-sm">
            <strong>استيراد من Excel</strong>
            <p className="small muted" style={{ margin: 0 }}>
              ارفع قائمة الأسماء، وتظهر لك معاينة بالمقبول والمكرر وما يحتاج تصحيحًا قبل الاعتماد.
            </p>
            <div className="row">
              <Link href={`/dashboard/events/${event.id}/import`} className="btn btn-dark btn-sm">
                استيراد قائمة
              </Link>
              <a href="/api/import/template" className="btn btn-sm">
                تنزيل ملف نموذجي
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {total > 0 && editable ? (
        <form action={setChannelAllAction} className="row card-lilac">
          <input type="hidden" name="eventId" value={event.id} />
          <label htmlFor="channelAll" className="label">
            قناة الإرسال للقائمة كاملة:
          </label>
          <select id="channelAll" name="channel" className="select" style={{ width: "auto" }} defaultValue="WHATSAPP">
            <option value="WHATSAPP">واتساب</option>
            <option value="EMAIL">البريد</option>
            <option value="BOTH">واتساب والبريد</option>
          </select>
          <SubmitButton className="btn btn-sm btn-dark">تطبيق</SubmitButton>
          <span className="small muted">يُعدّل تلقائيًا لكل مدعو حسب بيانات التواصل المتاحة</span>
        </form>
      ) : null}

      <Filters filters={PRIVATE_FILTERS} active={filter} base={base} q={q} />

      {invitations.length === 0 ? (
        <Empty>{total === 0 ? "لم تُضف مدعوين بعد." : "لا يوجد مدعوون في هذا التصنيف."}</Empty>
      ) : (
        <div className="list">
          <div className="small muted">
            {invitations.length} من {total} دعوة
          </div>
          {invitations.map((inv) => {
            const reg = inv.registration;
            return (
              <div key={inv.id} className="list-item stack-sm">
                <div className="row-between">
                  <span className="title">
                    {inv.name} {inv.allowCompanion ? <Badge tone="info">يسمح بمرافق</Badge> : null}
                  </span>
                  <div className="row" style={{ gap: "0.35rem" }}>
                    <DeliveryBadge status={inv.deliveryStatus} />
                    <RsvpBadge status={reg?.status} />
                  </div>
                </div>
                <div className="small muted row" style={{ gap: "0.25rem 0.9rem" }}>
                  {inv.phone ? <bdi className="ltr">{displayPhone(inv.phone)}</bdi> : null}
                  {inv.email ? <bdi className="ltr">{inv.email}</bdi> : null}
                  <span>القناة: {channelLabel[inv.channel]}</span>
                  {reg?.status === "CONFIRMED" ? <span>المقاعد: {reg.seats}</span> : null}
                  {reg?.status === "WAITLISTED" ? <span>يطلب {reg.seatsRequested} مقعد</span> : null}
                </div>
                {reg ? <Attendance tickets={reg.tickets} tz={event.timezone} /> : null}
                <div className="row">
                  <CopyButton text={links.invitation(inv.token)} label="نسخ رابط الدعوة" />
                  {reg?.status === "CONFIRMED" ? (
                    <>
                      <form action={resendTicketAction}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="registrationId" value={reg.id} />
                        <SubmitButton className="btn btn-sm">إعادة إرسال التذكرة</SubmitButton>
                      </form>
                      <form action={cancelRegistrationAction}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="registrationId" value={reg.id} />
                        <SubmitButton className="btn btn-sm btn-danger" confirm={`إلغاء تأكيد ${inv.name}؟ ستُلغى تذاكره وتتحرر المقاعد.`}>
                          إلغاء التأكيد
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                  {editable ? (
                    <details>
                      <summary className="btn btn-sm">تعديل</summary>
                      <form action={updateInvitationAction} className="stack-sm card-flat" style={{ marginTop: 8 }}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <InviteFields
                          d={{
                            name: inv.name,
                            phone: inv.phone ?? "",
                            email: inv.email ?? "",
                            channel: inv.channel,
                            allowCompanion: inv.allowCompanion,
                          }}
                          idPrefix={inv.id}
                        />
                        <div className="row">
                          <SubmitButton className="btn btn-sm btn-primary">حفظ</SubmitButton>
                        </div>
                      </form>
                      {!reg || !["CONFIRMED", "WAITLISTED", "OFFERED"].includes(reg.status) ? (
                        <form action={deleteInvitationAction} style={{ marginTop: 8 }}>
                          <input type="hidden" name="eventId" value={event.id} />
                          <input type="hidden" name="invitationId" value={inv.id} />
                          <SubmitButton className="btn btn-sm btn-danger" confirm={`حذف ${inv.name} من القائمة؟`}>
                            حذف المدعو
                          </SubmitButton>
                        </form>
                      ) : null}
                    </details>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Filters({ filters, active, base, q }: { filters: { key: string; label: string }[]; active: string; base: string; q: string }) {
  return (
    <div className="stack-sm">
      <form className="row" action={base}>
        <input type="hidden" name="filter" value={active} />
        <input name="q" className="input" placeholder="بحث بالاسم أو الجوال أو البريد" defaultValue={q} style={{ flex: "1 1 220px" }} />
        <button className="btn btn-sm">بحث</button>
      </form>
      <div className="tabs" style={{ marginBottom: 0 }}>
        {filters.map((f) => (
          <Link key={f.key} href={`${base}?filter=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={f.key === active ? "active" : undefined}>
            {f.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function InviteFields({
  d = { name: "", phone: "", email: "", channel: "WHATSAPP", allowCompanion: false },
  idPrefix = "new",
}: {
  d?: { name: string; phone: string; email: string; channel: string; allowCompanion: boolean };
  idPrefix?: string;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>الاسم</label>
        <input id={`${idPrefix}-name`} name="name" className="input" required defaultValue={d.name} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={`${idPrefix}-phone`}>رقم الجوال (واتساب)</label>
          <input id={`${idPrefix}-phone`} name="phone" type="tel" className="input" placeholder="05xxxxxxxx" defaultValue={d.phone} />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-email`}>البريد الإلكتروني</label>
          <input id={`${idPrefix}-email`} name="email" type="email" className="input" defaultValue={d.email} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-channel`}>قناة الإرسال</label>
        <select id={`${idPrefix}-channel`} name="channel" className="select" defaultValue={d.channel}>
          <option value="WHATSAPP">واتساب</option>
          <option value="EMAIL">البريد</option>
          <option value="BOTH">واتساب والبريد</option>
        </select>
        <span className="hint">إذا لم تتوفر بيانات القناة المختارة تُستخدم المتاحة تلقائيًا.</span>
      </div>
      <label className="check">
        <input type="checkbox" name="allowCompanion" defaultChecked={d.allowCompanion} />
        <span>
          تسمح باصطحاب مرافق واحد <span className="small muted">(تُحسب مكانين في الباقة)</span>
        </span>
      </label>
    </>
  );
}
