import { Logo } from "./Logo";
import { DemoBanner } from "./Shell";
import { brand } from "@/config/brand";

export function GuestShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="guest-page">
      <DemoBanner />
      <div className="guest-wrap">
        <div className="guest-brand">
          <Logo size={28} />
        </div>
        {children}
        <div className="footer">
          {brand.fullName} — {brand.tagline}
        </div>
      </div>
    </div>
  );
}

export function ResultBox({
  tone,
  icon,
  title,
  children,
}: {
  tone: "ok" | "warn" | "err" | "info";
  icon: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`result result-${tone}`} role="status">
      <div className="icon" aria-hidden>
        {icon}
      </div>
      <h2 style={{ marginBottom: 6 }}>{title}</h2>
      {children}
    </div>
  );
}
