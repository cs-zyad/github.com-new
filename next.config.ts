import type { NextConfig } from "next";

/**
 * عناوين إضافية يُسمح منها باستدعاء إجراءات الخادم (حماية CSRF في Next تقارن Origin بالـ Host).
 * نحتاجها خلف وسيط يمرّر عنوانه الداخلي (مثل GitHub Codespaces): عنوان APP_URL + EXTRA_ALLOWED_ORIGINS.
 */
function allowedOrigins(): string[] {
  const out: string[] = [];
  try {
    if (process.env.APP_URL) out.push(new URL(process.env.APP_URL).host);
  } catch {
    // تجاهل قيمة غير صالحة
  }
  for (const o of (process.env.EXTRA_ALLOWED_ORIGINS ?? "").split(",")) if (o.trim()) out.push(o.trim());
  return out;
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "exceljs", "qrcode"],
  poweredByHeader: false,
  allowedDevOrigins: allowedOrigins(),
  experimental: {
    serverActions: { allowedOrigins: allowedOrigins() },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
