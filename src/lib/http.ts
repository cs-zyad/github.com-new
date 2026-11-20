/** حماية بسيطة من الطلبات عبر المواقع لمسارات API التي تعتمد على كوكي الجلسة */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // بدون Origin — كوكي SameSite=Lax يحمي
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  const host = req.headers.get("host");
  const fwd = req.headers.get("x-forwarded-host");
  if (host) allowed.add(host);
  if (fwd) allowed.add(fwd.split(",")[0].trim());
  // العنوان العام للمنصة (خلف وسيط يمرّر عنوانه الداخلي مثل Codespaces)
  try {
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host);
  } catch {
    // تجاهل
  }
  return allowed.has(originHost);
}
