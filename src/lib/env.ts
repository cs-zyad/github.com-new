/** قراءة متغيرات البيئة في مكان واحد (خادم فقط) */

export const env = {
  get appUrl() {
    // على Vercel: الرابط الدائم للمشروع إن لم يُحدَّد APP_URL
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const url = process.env.APP_URL || (vercel ? `https://${vercel}` : "http://localhost:3000");
    return url.replace(/\/$/, "");
  },
  get demoMode() {
    return (process.env.DEMO_MODE ?? "true") === "true";
  },
  get whatsappProvider() {
    return process.env.WHATSAPP_PROVIDER || "mock";
  },
  get emailProvider() {
    return process.env.EMAIL_PROVIDER || "mock";
  },
  get paymentProvider() {
    return process.env.PAYMENT_PROVIDER || "mock";
  },
  get paymentWebhookSecret() {
    return process.env.PAYMENT_WEBHOOK_SECRET || "dev-payment-webhook-secret";
  },
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  get runWorker() {
    return (process.env.RUN_WORKER ?? "true") === "true";
  },
};
