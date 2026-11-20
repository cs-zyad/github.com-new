import { brand } from "@/config/brand";

/**
 * شعار وفدة: زاويتا إطار المسح + علامة التأكيد.
 * يُستبدل بملف الشعار الرسمي من حزمة الهوية عند توفرها.
 */
export function LogoMark({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) {
  const frame = onDark ? brand.colors.lime : brand.colors.plum;
  const check = onDark ? brand.colors.ivory : brand.colors.plum;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M6 18V10a4 4 0 0 1 4-4h8" stroke={frame} strokeWidth="5" strokeLinecap="round" />
      <path d="M42 30v8a4 4 0 0 1-4 4h-8" stroke={frame} strokeWidth="5" strokeLinecap="round" />
      <path d="M15 24.5l6.5 6.5L34 17.5" stroke={check} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ onDark = false, size = 30 }: { onDark?: boolean; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoMark size={size} onDark={onDark} />
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontFamily: "var(--font-head)", fontWeight: 700 }}>
        <span style={{ fontSize: size * 0.72 }}>{brand.nameAr}</span>
        <span style={{ fontFamily: "var(--font-latin)", fontSize: size * 0.4, letterSpacing: 2, opacity: 0.8 }}>{brand.nameEn}</span>
      </span>
    </span>
  );
}
