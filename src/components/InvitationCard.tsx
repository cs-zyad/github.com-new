import type { EventView } from "@/services/presentation";
import type { Palette } from "@/services/designs";
import { brand } from "@/config/brand";

/**
 * بطاقة الدعوة حسب القالب. التصميم ثابت لكل قالب، والمنظّم يعبّي البيانات فقط.
 * نفس البيانات (eventView) تظهر في صفحة الدعوة والمعاينة ونص الرسالة.
 */
export type InvitationCardProps = {
  layout: string;
  palette: Palette;
  view: EventView;
  mode: string;
  guestName?: string | null;
  allowCompanion?: boolean;
};

function Corner({ color, pos }: { color: string; pos: "tr" | "bl" | "tl" | "br" }) {
  const base: React.CSSProperties = { position: "absolute", width: 38, height: 38, borderColor: color, borderStyle: "solid" };
  const map: Record<string, React.CSSProperties> = {
    tr: { top: 14, right: 14, borderWidth: "4px 4px 0 0", borderRadius: "0 12px 0 0" },
    bl: { bottom: 14, left: 14, borderWidth: "0 0 4px 4px", borderRadius: "0 0 0 12px" },
    tl: { top: 14, left: 14, borderWidth: "4px 0 0 4px", borderRadius: "12px 0 0 0" },
    br: { bottom: 14, right: 14, borderWidth: "0 4px 4px 0", borderRadius: "0 0 12px 0" },
  };
  return <span aria-hidden style={{ ...base, ...map[pos] }} />;
}

function Details({ view, color, muted }: { view: EventView; color: string; muted: string }) {
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 14.5, color }}>
      <div>
        <div style={{ color: muted, fontSize: 12 }}>الموعد</div>
        <div style={{ fontWeight: 600 }}>{view.dateText}</div>
        <div>
          {view.timeText}
          {view.endTimeText ? ` — ${view.endTimeText}` : ""}
        </div>
      </div>
      <div>
        <div style={{ color: muted, fontSize: 12 }}>المكان</div>
        <div style={{ fontWeight: 600 }}>{view.venueName}</div>
        {view.venueAddress ? <div>{view.venueAddress}</div> : null}
      </div>
    </div>
  );
}

function Greeting({ guestName, mode, color }: { guestName?: string | null; mode: string; color: string }) {
  if (mode === "PRIVATE" && guestName) {
    return (
      <div style={{ fontSize: 15, color }}>
        <span style={{ opacity: 0.8 }}>دعوة خاصة إلى</span>{" "}
        <strong style={{ fontFamily: "var(--font-head)" }}>{guestName}</strong>
      </div>
    );
  }
  return <div style={{ fontSize: 14, color, opacity: 0.85 }}>{mode === "PUBLIC" ? "دعوة عامة" : "دعوة خاصة"}</div>;
}

export function InvitationCard({ layout, palette: p, view, mode, guestName, allowCompanion }: InvitationCardProps) {
  const companion = allowCompanion ? (
    <div style={{ fontSize: 13, marginTop: 10, opacity: 0.9 }}>الدعوة تسمح باصطحاب مرافق واحد</div>
  ) : null;
  const host = view.hostName ? <div style={{ fontSize: 13.5, opacity: 0.85, marginBottom: 4 }}>{view.hostName} يدعوكم</div> : null;
  const footer = (color: string) => (
    <div style={{ fontSize: 11, color, opacity: 0.7, marginTop: 14, fontFamily: "var(--font-latin)" }}>{brand.fullName}</div>
  );
  const shell: React.CSSProperties = {
    position: "relative",
    borderRadius: 20,
    overflow: "hidden",
    boxShadow: "0 8px 30px rgba(40,24,44,.12)",
  };

  switch (layout) {
    case "ivory-classic":
      return (
        <div style={{ ...shell, background: p.background, color: p.text, padding: 14 }}>
          <div style={{ border: `2px solid ${p.primary}`, borderRadius: 14, padding: 4 }}>
            <div style={{ border: `1px solid ${p.primary}`, borderRadius: 10, padding: "28px 20px", textAlign: "center" }}>
              <Greeting guestName={guestName} mode={mode} color={p.muted} />
              <div style={{ width: 60, height: 3, background: p.accent, margin: "14px auto", borderRadius: 3 }} />
              {host}
              <h2 style={{ fontSize: 26, color: p.primary, margin: "6px 0 10px" }}>{view.title}</h2>
              {view.description ? <p style={{ color: p.muted, fontSize: 14 }}>{view.description}</p> : null}
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <Details view={view} color={p.text} muted={p.muted} />
              </div>
              {companion}
              {footer(p.muted)}
            </div>
          </div>
        </div>
      );

    case "lilac-soft":
      return (
        <div style={{ ...shell, background: p.background, color: p.text, padding: "30px 22px" }}>
          <span
            aria-hidden
            style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", background: p.accent, opacity: 0.55, top: -70, left: -60 }}
          />
          <span
            aria-hidden
            style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", background: p.primary, opacity: 0.08, bottom: -40, right: -30 }}
          />
          <div style={{ position: "relative" }}>
            <Greeting guestName={guestName} mode={mode} color={p.muted} />
            <div style={{ height: 14 }} />
            {host}
            <h2 style={{ fontSize: 26, color: p.primary, margin: "0 0 10px" }}>{view.title}</h2>
            {view.description ? <p style={{ color: p.muted, fontSize: 14 }}>{view.description}</p> : null}
            <div style={{ background: "rgba(255,255,255,.75)", borderRadius: 14, padding: 14, marginTop: 10 }}>
              <Details view={view} color={p.text} muted={p.muted} />
            </div>
            {companion}
            {footer(p.muted)}
          </div>
        </div>
      );

    case "corporate-clean":
      return (
        <div style={{ ...shell, background: p.background, color: p.text, display: "flex" }}>
          <div style={{ width: 10, background: p.primary, flexShrink: 0 }} />
          <div style={{ padding: "26px 22px", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <Greeting guestName={guestName} mode={mode} color={p.muted} />
              <span style={{ background: p.accent, color: p.primary, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
                دعوة
              </span>
            </div>
            <div style={{ height: 16 }} />
            {host}
            <h2 style={{ fontSize: 24, color: p.primary, margin: "0 0 8px" }}>{view.title}</h2>
            {view.description ? <p style={{ color: p.muted, fontSize: 14 }}>{view.description}</p> : null}
            <hr style={{ borderColor: "#e6dfe9", margin: "14px 0" }} />
            <Details view={view} color={p.text} muted={p.muted} />
            {companion}
            {footer(p.muted)}
          </div>
        </div>
      );

    case "workshop-bold":
      return (
        <div style={{ ...shell, background: p.background, color: p.text }}>
          <div style={{ background: p.accent, color: p.primary, padding: "26px 22px 22px" }}>
            <Greeting guestName={guestName} mode={mode} color={p.primary} />
            <div style={{ height: 10 }} />
            {host}
            <h2 style={{ fontSize: 27, color: p.primary, margin: 0 }}>{view.title}</h2>
          </div>
          <div style={{ padding: "18px 22px 22px" }}>
            {view.description ? <p style={{ color: p.muted, fontSize: 14 }}>{view.description}</p> : null}
            <Details view={view} color={p.text} muted={p.muted} />
            {companion}
            {footer(p.muted)}
          </div>
        </div>
      );

    case "plum-frame":
    default:
      return (
        <div style={{ ...shell, background: p.primary, color: p.background, padding: "40px 26px", textAlign: "center" }}>
          <Corner color={p.accent} pos="tr" />
          <Corner color={p.accent} pos="bl" />
          <Greeting guestName={guestName} mode={mode} color={p.background} />
          <div style={{ height: 16 }} />
          {host}
          <h2 style={{ fontSize: 28, color: p.accent, margin: "4px 0 12px" }}>{view.title}</h2>
          {view.description ? <p style={{ fontSize: 14, opacity: 0.85 }}>{view.description}</p> : null}
          <div
            style={{
              background: "rgba(255,255,255,.07)",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 14,
              padding: 14,
              marginTop: 12,
              textAlign: "right",
            }}
          >
            <Details view={view} color={p.background} muted={p.accent} />
          </div>
          {companion}
          {footer(p.background)}
        </div>
      );
  }
}
