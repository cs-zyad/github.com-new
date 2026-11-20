import { TEMPLATE_LAYOUTS } from "@/lib/constants";
import type { Palette } from "@/services/designs";

export const layoutLabel: Record<string, string> = {
  "plum-frame": "إطار برقوقي",
  "ivory-classic": "عاجي كلاسيكي",
  "lilac-soft": "ليلكي ناعم",
  "corporate-clean": "رسمي للشركات",
  "workshop-bold": "ورش وتدريب",
};

export function LayoutSelect({ defaultValue, id }: { defaultValue?: string; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>التخطيط</label>
      <select id={id} name="layout" className="select" defaultValue={defaultValue ?? "plum-frame"}>
        {TEMPLATE_LAYOUTS.map((l) => (
          <option key={l} value={l}>
            {layoutLabel[l]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PaletteFields({ p, idPrefix }: { p: Palette; idPrefix: string }) {
  const fields: [keyof Palette, string][] = [
    ["primary", "الأساسي"],
    ["accent", "المميز"],
    ["background", "الخلفية"],
    ["text", "النص"],
    ["muted", "النص الثانوي"],
  ];
  return (
    <div className="row" style={{ gap: "0.5rem" }}>
      {fields.map(([k, label]) => (
        <label key={k} className="field" style={{ alignItems: "center" }} htmlFor={`${idPrefix}-${k}`}>
          <span className="small">{label}</span>
          <input id={`${idPrefix}-${k}`} type="color" name={k} defaultValue={p[k]} style={{ width: 48, height: 36, border: 0, background: "none" }} />
        </label>
      ))}
    </div>
  );
}
