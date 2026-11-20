import Link from "next/link";
import { notFound } from "next/navigation";
import { inboxMessages } from "@/services/queries";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { messageKindLabel, messageStatusLabel, channelLabel } from "@/lib/labels";
import { displayPhone } from "@/lib/contact";
import { TopBar } from "@/components/Shell";
import { getCurrentUser } from "@/lib/auth";
import { Badge } from "@/components/ui";

export const metadata = { title: "صندوق الرسائل التجريبي", robots: { index: false } };
export const dynamic = "force-dynamic";

/** يحوّل الروابط في نص الرسالة إلى روابط قابلة للنقر (نسبية حتى تعمل من أي عنوان) */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!/^https?:\/\//.test(p)) return <span key={i}>{p}</span>;
        const href = p.startsWith(env.appUrl) ? p.slice(env.appUrl.length) || "/" : p;
        return (
          <a key={i} href={href} className="ltr" style={{ wordBreak: "break-all" }}>
            {p}
          </a>
        );
      })}
    </>
  );
}

/**
 * صندوق الرسائل التجريبي — يعرض ما "أُرسل" عبر المزوّدات التجريبية.
 * متاح فقط في الوضع التجريبي (DEMO_MODE=true) ويجب تعطيله في الإنتاج.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (!env.demoMode) notFound();
  const sp = await searchParams;
  const user = await getCurrentUser();
  const to = (sp.to ?? "").trim();
  const messages = await inboxMessages(to);
  return (
    <>
      <TopBar user={user} home={user ? "/dashboard" : "/"} />
      <main className="container" style={{ padding: "1.25rem 16px 3rem", maxWidth: 820 }}>
        <div className="stack">
          <div>
            <h1>صندوق الرسائل التجريبي</h1>
            <p className="muted small">
              هنا تظهر رسائل واتساب والبريد في الوضع التجريبي بدل إرسالها فعليًا. افتح رابط الدعوة أو التذكرة من الرسالة لتجربة رحلة الضيف. لمحاكاة
              الفشل: رقم ينتهي بـ <bdi className="ltr">0000</bdi> أو بريد يحتوي <bdi className="ltr">fail</bdi>.
            </p>
          </div>
          <form className="row" action="/dev/inbox">
            <input name="to" className="input ltr-input" placeholder="تصفية حسب الرقم أو البريد" defaultValue={to} style={{ flex: "1 1 220px" }} />
            <button className="btn btn-sm">تصفية</button>
            {to ? (
              <Link href="/dev/inbox" className="btn btn-sm btn-ghost">
                إزالة التصفية
              </Link>
            ) : null}
          </form>
          {messages.length === 0 ? <div className="empty">لا توجد رسائل.</div> : null}
          {messages.map((m) => (
            <article key={m.id} className="card stack-sm">
              <div className="row-between small">
                <span className="row" style={{ gap: "0.4rem" }}>
                  <Badge tone={m.channel === "WHATSAPP" ? "ok" : "info"}>{channelLabel[m.channel]}</Badge>
                  <Badge tone="neutral">{messageKindLabel[m.kind]}</Badge>
                  <Badge tone={m.status === "SENT" ? "ok" : m.status === "FAILED" ? "err" : "warn"}>{messageStatusLabel[m.status]}</Badge>
                </span>
                <span className="muted">{formatDateTime(m.createdAt)}</span>
              </div>
              <div className="small">
                إلى: <bdi className="ltr">{m.channel === "WHATSAPP" ? displayPhone(m.recipient) : m.recipient}</bdi>
                {m.event ? <span className="muted"> · {m.event.title}</span> : null}
              </div>
              {m.lastError ? <div className="alert alert-err small">{m.lastError}</div> : null}
              <div className={`msg-preview${m.channel === "EMAIL" ? " email" : ""}`}>
                {m.subject && m.channel === "EMAIL" ? (
                  <>
                    <strong>{m.subject}</strong>
                    {"\n\n"}
                  </>
                ) : null}
                <Linkified text={m.body} />
              </div>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
