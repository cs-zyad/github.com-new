"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

/** زر إرسال يمنع الضغط المتكرر أثناء التنفيذ */
export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingText = "جارٍ التنفيذ…",
  confirm,
  name,
  value,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  confirm?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
      name={name}
      value={value}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function CopyButton({ text, label = "نسخ", className = "btn btn-sm" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "تم النسخ ✓" : label}
    </button>
  );
}

export function CopyField({ text }: { text: string }) {
  return (
    <div className="copy-box">
      <input className="input" readOnly value={text} onFocus={(e) => e.currentTarget.select()} aria-label="الرابط" />
      <CopyButton text={text} label="نسخ الرابط" className="btn btn-dark" />
    </div>
  );
}

/** مشاركة عبر قائمة المشاركة في الجوال أو واتساب */
export function ShareButton({ url, text, label = "مشاركة" }: { url: string; text: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ title: text, text, url });
            return;
          } catch {
            /* أُلغيت */
          }
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
      }}
    >
      {label}
    </button>
  );
}

/** يحدّث الصفحة دوريًا (مثل لوحة الفعالية أثناء الاستقبال) */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [seconds, router]);
  return null;
}

export function PrintButton({ label = "طباعة" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-sm" onClick={() => window.print()}>
      {label}
    </button>
  );
}
