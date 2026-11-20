/** حماية بسيطة من الطلبات عبر المواقع لمسارات API التي تعتمد على ملف تعريف الجلسة */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // طلبات من نفس الصفحة بدون Origin (بعض المتصفحات القديمة) — الكوكي SameSite=Lax يحمي
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
