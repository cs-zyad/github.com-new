import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/ids";
import { getOwnedEvent, requiredPrivatePlaces } from "@/services/events";
import { previewInvitationSend, previewReminder } from "@/services/sending";
import { getSettings } from "@/lib/settings";
import { formatDateTime, dateToLocalInput, formatMoney } from "@/lib/format";
import { messageKindLabel, jobStatusLabel } from "@/lib/labels";
import { Flash, Money, Badge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { sendInvitationsAction, sendReminderNowAction, scheduleReminderAction, cancelReminderAction } from "@/app/actions/events";

export default async function SendPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  if (event.mode !== "PRIVATE") return <div className="alert alert-info">الإرسال متاح للدعوات الخاصة. شارك الرابط العام من صفحة الباقة.</div>;

  const [notSent, failed, reminder, required, settings, jobs, batches] = await Promise.all([
    previewInvitationSend(user.id, event.id, "NOT_SENT"),
    previewInvitationSend(user.id, event.id, "FAILED"),
    previewReminder(user.id, event.id),
    requiredPrivatePlaces(event.id),
    getSettings(),
    prisma.scheduledJob.findMany({ where: { eventId: event.id }, orderBy: { runAt: "desc" }, take: 10 }),
    prisma.messageBatch.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { messages: { select: { status: true } } },
    }),
  ]);
  const active = event.status === "ACTIVE";
  const coverageOk = required <= event.paidPlaces;
  const balance = notSent.balance;
  const defaultRunAt = dateToLocalInput(new Date(Math.min(event.startsAt.getTime() - 86400000, Date.now() + 86400000)));

  const SendBox = ({
    title,
    hint,
    p,
    target,
    cta,
  }: {
    title: string;
    hint: string;
    p: typeof notSent;
    target: "NOT_SENT" | "FAILED";
    cta: string;
  }) => (
    <div className="card stack-sm">
      <h3>{title}</h3>
      <p className="small muted" style={{ margin: 0 }}>
        {hint}
      </p>
      <dl className="kv">
        <dt>المدعوون</dt>
        <dd>{p.recipients}</dd>
        <dt>الرسائل</dt>
        <dd>
          {p.count} (واتساب {p.byChannel.WHATSAPP} · بريد {p.byChannel.EMAIL})
        </dd>
        <dt>التكلفة المتوقعة</dt>
        <dd>
          <strong>
            <Money value={p.total} />
          </strong>
        </dd>
      </dl>
      {!p.enough && p.count > 0 ? (
        <div className="alert alert-warn small">
          الرصيد الحالي <Money value={balance} /> لا يكفي.{" "}
          {settings.insufficientBalancePolicy === "BLOCK" ? "لن يُرسل شيء حتى تشحن الرصيد." : "سيُرسل لأكبر عدد يغطيه الرصيد."}{" "}
          <Link href="/dashboard/wallet">اشحن الرصيد</Link>
        </div>
      ) : null}
      <form action={sendInvitationsAction}>
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="batchKey" value={randomToken(12)} />
        <SubmitButton
          className="btn btn-primary"
          disabled={!active || !coverageOk || p.count === 0}
          confirm={`سيُخصم ${formatMoney(p.total)} من رصيد الرسائل لإرسال ${p.count} رسالة. متابعة؟`}
        >
          {cta}
        </SubmitButton>
      </form>
    </div>
  );

  return (
    <div className="stack">
      <Flash sp={sp} />
      <div className="row-between card-lilac">
        <span>
          رصيد الرسائل: <strong><Money value={balance} /></strong> · سعر الرسالة: واتساب <Money value={settings.messagePrice.WHATSAPP} /> · بريد{" "}
          <Money value={settings.messagePrice.EMAIL} />
        </span>
        <Link href="/dashboard/wallet" className="btn btn-sm">
          شحن الرصيد
        </Link>
      </div>
      {!active ? (
        <div className="alert alert-warn">
          الإرسال متاح بعد دفع الباقة. <Link href={`/dashboard/events/${event.id}/billing`}>انتقل إلى الباقة والدفع</Link>
        </div>
      ) : !coverageOk ? (
        <div className="alert alert-warn">
          المدعوون يحتاجون {required} مكانًا والباقة المدفوعة {event.paidPlaces}.{" "}
          <Link href={`/dashboard/events/${event.id}/billing`}>اشترِ {required - event.paidPlaces} مكانًا إضافيًا</Link> قبل الإرسال.
        </div>
      ) : null}

      <div className="grid-2">
        <SendBox title="إرسال الدعوات" hint="الدعوات التي لم تُرسل بعد، كلٌّ حسب قناته." p={notSent} target="NOT_SENT" cta="أرسل الدعوات" />
        <SendBox
          title="إعادة المحاولة للمتعذّر"
          hint="الدعوات التي تعذّر إرسالها. صحّح الرقم أو القناة من قائمة المدعوين ثم أعد المحاولة."
          p={failed}
          target="FAILED"
          cta="أعد إرسال المتعذّر"
        />
      </div>

      <section className="card stack">
        <h2>التذكيرات</h2>
        <p className="small muted" style={{ margin: 0 }}>
          التذكير يصل لمن وصلته الدعوة ولم يرد بعد. في التذكير المجدول تُفحص الحالة لحظة التنفيذ، فمن أكّد قبلها لا يصله.
        </p>
        <div className="grid-2">
          <div className="card-flat stack-sm">
            <h3>تذكير الآن</h3>
            <dl className="kv">
              <dt>بحاجة لتذكير</dt>
              <dd>{reminder.recipients}</dd>
              <dt>التكلفة المتوقعة</dt>
              <dd>
                <Money value={reminder.total} /> ({reminder.count} رسالة)
              </dd>
            </dl>
            <form action={sendReminderNowAction}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="batchKey" value={randomToken(12)} />
              <SubmitButton
                className="btn btn-dark"
                disabled={!active || reminder.count === 0}
                confirm={`سيُخصم ${formatMoney(reminder.total)} لإرسال ${reminder.count} رسالة تذكير. متابعة؟`}
              >
                أرسل التذكير الآن
              </SubmitButton>
            </form>
          </div>
          <div className="card-flat stack-sm">
            <h3>جدولة تذكير</h3>
            <form action={scheduleReminderAction} className="stack-sm">
              <input type="hidden" name="eventId" value={event.id} />
              <div className="field">
                <label htmlFor="runAt">موعد التذكير (بتوقيت الرياض)</label>
                <input id="runAt" name="runAt" type="datetime-local" className="input" required defaultValue={defaultRunAt} />
                <span className="hint">
                  التكلفة المتوقعة الآن <Money value={reminder.total} />، وتُحسب الفعلية عند التنفيذ حسب من لا يزال بحاجة للتذكير.
                </span>
              </div>
              <SubmitButton className="btn" disabled={!active}>
                جدولة
              </SubmitButton>
            </form>
          </div>
        </div>
        {jobs.length ? (
          <div className="list">
            {jobs.map((j) => {
              const result = j.result ? (JSON.parse(j.result) as Record<string, unknown>) : null;
              return (
                <div key={j.id} className="list-item row-between">
                  <span>
                    تذكير {formatDateTime(j.runAt, event.timezone)}{" "}
                    <Badge tone={j.status === "DONE" ? "ok" : j.status === "FAILED" ? "err" : j.status === "PENDING" ? "info" : "neutral"}>
                      {jobStatusLabel[j.status]}
                    </Badge>
                    {result && j.status === "DONE" ? (
                      <span className="small muted">
                        {" "}
                        — وصل لـ {String(result.recipients)} مدعو، التكلفة {formatMoney(Number(result.cost ?? 0))}
                      </span>
                    ) : null}
                    {result && j.status === "FAILED" ? <span className="small" style={{ color: "var(--err-fg)" }}> — {String(result.message ?? result.reason)}</span> : null}
                  </span>
                  {j.status === "PENDING" ? (
                    <form action={cancelReminderAction}>
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="jobId" value={j.id} />
                      <SubmitButton className="btn btn-sm btn-danger">إلغاء</SubmitButton>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="stack-sm">
        <div className="row-between">
          <h2 style={{ margin: 0 }}>سجل عمليات الإرسال</h2>
          <Link href={`/dashboard/events/${event.id}/messages`} className="small">
            كل الرسائل بالتفصيل
          </Link>
        </div>
        {batches.length === 0 ? (
          <Empty>لا توجد عمليات إرسال بعد.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>النوع</th>
                  <th>الطريقة</th>
                  <th className="num">الرسائل</th>
                  <th>النتيجة</th>
                  <th className="num">الخصم</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const sent = b.messages.filter((m) => m.status === "SENT").length;
                  const failedN = b.messages.filter((m) => m.status === "FAILED").length;
                  const pendingN = b.messages.length - sent - failedN;
                  return (
                    <tr key={b.id}>
                      <td className="nowrap">{formatDateTime(b.createdAt, event.timezone)}</td>
                      <td>{messageKindLabel[b.kind]}</td>
                      <td>{b.trigger === "SCHEDULED" ? "مجدول" : "يدوي"}</td>
                      <td className="num">{b.messageCount}</td>
                      <td className="small">
                        <Badge tone="ok">{sent} أُرسلت</Badge> {failedN ? <Badge tone="err">{failedN} فشلت</Badge> : null}{" "}
                        {pendingN ? <Badge tone="warn">{pendingN} قيد الإرسال</Badge> : null}
                      </td>
                      <td className="num">
                        <Money value={b.totalCost} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">الرسائل الفاشلة نهائيًا يُسترجع مبلغها للرصيد تلقائيًا (حسب إعدادات التشغيل).</p>
      </section>
    </div>
  );
}
