/** قراءة متغيرات البيئة في مكان واحد (خادم فقط) */

export const env = {
  get appUrl() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
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
