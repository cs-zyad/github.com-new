/**
 * تنسيق التواريخ والمبالغ — مكان واحد يحدد شكل العرض.
 * نستخدم التقويم الميلادي والأرقام اللاتينية لتجنّب الالتباس بجانب أرقام الجوال والبريد.
 */

export const DISPLAY_LOCALE = "ar-SA-u-ca-gregory-nu-latn";
export const DEFAULT_TZ = "Asia/Riyadh";

export function formatDate(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(new Date(d));
}

export function formatTime(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(d));
}

export function formatShortDateTime(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(d));
}

/** فرق التوقيت (بالدقائق) للمنطقة الزمنية في لحظة معينة */
function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** تحويل قيمة datetime-local (YYYY-MM-DDTHH:mm) بتوقيت المنطقة إلى Date (UTC) */
export function localInputToDate(value: string, tz = DEFAULT_TZ): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const offset = tzOffsetMinutes(guess, tz);
  const result = new Date(guess.getTime() - offset * 60000);
  // تصحيح عند تغيّر التوقيت الصيفي
  const offset2 = tzOffsetMinutes(result, tz);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60000);
}

/** تحويل Date إلى قيمة datetime-local بتوقيت المنطقة */
export function dateToLocalInput(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  const date = new Date(d);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** المبلغ بالهللة إلى نص بالريال */
export function formatMoney(halalas: number, currency = "SAR"): string {
  const value = (halalas / 100).toLocaleString("en-US", {
    minimumFractionDigits: halalas % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const symbol = currency === "SAR" ? "ر.س" : currency;
  return `${value} ${symbol}`;
}

/** تحويل نص بالريال إلى هللة */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(String(input).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
