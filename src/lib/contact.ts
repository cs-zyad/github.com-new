/** توحيد أرقام الجوال والبريد والتحقق منها */

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
  });
}

/**
 * يعيد الرقم بصيغة E.164 أو null إذا كان غير صالح.
 * يقبل الصيغ السعودية الشائعة: 05xxxxxxxx، 5xxxxxxxx، 9665xxxxxxxx، +9665xxxxxxxx، 009665xxxxxxxx
 * ويقبل الأرقام الدولية التي تبدأ بـ + أو 00.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = toLatinDigits(String(input)).trim();
  if (!s) return null;
  s = s.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^05\d{8}$/.test(s)) return "+966" + s.slice(1);
  if (/^5\d{8}$/.test(s)) return "+966" + s;
  if (/^9665\d{8}$/.test(s)) return "+" + s;
  if (/^\+9665\d{8}$/.test(s)) return s;
  if (/^\+966/.test(s)) return null; // رقم سعودي بصيغة غير صحيحة
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normalizeEmail(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().toLowerCase();
  if (!s || s.length > 254) return null;
  return EMAIL_RE.test(s) ? s : null;
}

/** عرض الرقم بشكل مقروء */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+966(5\d)(\d{3})(\d{4})$/.exec(e164);
  if (m) return `+966 ${m[1]} ${m[2]} ${m[3]}`;
  return e164;
}

/** جزء رقمي للبحث: يقبل جزءًا من الرقم بأي صيغة */
export function phoneSearchFragment(q: string): string | null {
  const digits = toLatinDigits(q).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.replace(/^0+/, "");
}
