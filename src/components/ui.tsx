import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { deliveryLabel, regStatusLabel, eventStatusLabel } from "@/lib/labels";

type Tone = "ok" | "att" | "warn" | "err" | "info" | "neutral";

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** حالة إرسال الدعوة — "تعذّر الإرسال" مستقلة عن حالة التأكيد */
export function DeliveryBadge({ status }: { status: string }) {
  const tone: Tone = status === "SENT" ? "info" : status === "FAILED" ? "err" : status === "QUEUED" ? "warn" : "neutral";
  return <Badge tone={tone}>{deliveryLabel[status] ?? status}</Badge>;
}

/** حالة التأكيد (أو "لم يؤكد" عند عدم وجود تسجيل) */
export function RsvpBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "NONE";
  const tone: Tone =
    s === "CONFIRMED" ? "ok" : s === "WAITLISTED" ? "warn" : s === "OFFERED" ? "warn" : s === "NONE" ? "neutral" : "err";
  return <Badge tone={tone}>{regStatusLabel[s] ?? s}</Badge>;
}

export function AttendanceBadge({ at, label }: { at: Date | null | undefined; label?: string }) {
  return at ? <Badge tone="att">{label ?? "حضر"}</Badge> : <Badge tone="neutral">لم يحضر بعد</Badge>;
}

export function EventStatusBadge({ status }: { status: string }) {
  const tone: Tone = status === "ACTIVE" ? "ok" : status === "DRAFT" ? "info" : status === "CANCELLED" ? "err" : "neutral";
  return <Badge tone={tone}>{eventStatusLabel[status] ?? status}</Badge>;
}

export function Money({ value, currency = "SAR" }: { value: number; currency?: string }) {
  return <span className="money">{formatMoney(value, currency)}</span>;
}

export function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`stat${highlight ? " highlight" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div style={{ marginBottom: "1.1rem" }}>
      {back ? (
        <Link href={back.href} className="small muted" style={{ textDecoration: "none" }}>
          → {back.label}
        </Link>
      ) : null}
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 style={{ marginBottom: subtitle ? "0.2rem" : 0 }}>{title}</h1>
          {subtitle ? <div className="muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** رسائل النجاح/الخطأ القادمة من الإجراءات عبر الرابط */
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  if (!ok && !error) return null;
  return (
    <div className={`alert ${error ? "alert-err" : "alert-ok"}`} role={error ? "alert" : "status"} style={{ marginBottom: "1rem" }}>
      {error ?? ok}
    </div>
  );
}

export function Ltr({ children }: { children: React.ReactNode }) {
  return <bdi className="ltr">{children}</bdi>;
}
