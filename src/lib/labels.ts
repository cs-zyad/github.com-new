/** النصوص العربية للحالات — مصدر واحد لكل الواجهات */

export const eventStatusLabel: Record<string, string> = {
  DRAFT: "مسودة",
  ACTIVE: "نشطة",
  ENDED: "منتهية",
  CANCELLED: "ملغاة",
};

export const modeLabel: Record<string, string> = {
  PRIVATE: "دعوات خاصة",
  PUBLIC: "رابط عام",
};

export const fullPolicyLabel: Record<string, string> = {
  CLOSE: "إغلاق التسجيل عند اكتمال العدد",
  WAITLIST: "قائمة انتظار عند اكتمال العدد",
};

export const deliveryLabel: Record<string, string> = {
  NOT_SENT: "لم تُرسل",
  QUEUED: "قيد الإرسال",
  SENT: "أُرسلت",
  FAILED: "تعذّر الإرسال",
};

export const regStatusLabel: Record<string, string> = {
  CONFIRMED: "مؤكد",
  WAITLISTED: "قائمة الانتظار",
  OFFERED: "أُرسلت له فرصة",
  CANCELLED: "اعتذر",
  DECLINED: "اعتذر",
  NONE: "لم يؤكد",
};

export const channelLabel: Record<string, string> = {
  WHATSAPP: "واتساب",
  EMAIL: "البريد",
  BOTH: "واتساب والبريد",
};

export const messageKindLabel: Record<string, string> = {
  INVITATION: "دعوة",
  REMINDER: "تذكير",
  CONFIRMATION: "تأكيد الحضور والتذكرة",
  WAITLIST_OFFER: "فرصة من قائمة الانتظار",
  STAFF_INVITE: "دعوة فريق الاستقبال",
  TICKET_RESEND: "إعادة إرسال التذكرة",
};

export const messageStatusLabel: Record<string, string> = {
  QUEUED: "في الطابور",
  SENDING: "جارٍ الإرسال",
  SENT: "أُرسلت",
  FAILED: "فشلت",
};

export const billingLabel: Record<string, string> = {
  WALLET: "رصيد الرسائل",
  PACKAGE: "ضمن الباقة",
  NONE: "بدون تكلفة",
};

export const paymentPurposeLabel: Record<string, string> = {
  PACKAGE: "باقة الفعالية",
  EXTRA_PLACES: "أماكن إضافية",
  WALLET_TOPUP: "شحن رصيد الرسائل",
  DESIGN: "تصميم خاص",
};

export const paymentStatusLabel: Record<string, string> = {
  PENDING: "بانتظار الدفع",
  PAID: "مدفوع",
  FAILED: "فشل",
  CANCELLED: "ملغى",
};

export const designStatusLabel: Record<string, string> = {
  SUBMITTED: "بانتظار المراجعة",
  QUOTED: "وصل عرض السعر",
  ACCEPTED: "مقبول — بانتظار الدفع",
  PAID: "مدفوع",
  IN_PROGRESS: "قيد التنفيذ",
  DELIVERED: "تم التسليم",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
};

export const supportCategoryLabel: Record<string, string> = {
  COMPLAINT: "شكوى",
  QUESTION: "استفسار",
  BILLING: "الفوترة والدفع",
  TECHNICAL: "مشكلة تقنية",
};

export const supportStatusLabel: Record<string, string> = {
  OPEN: "مفتوحة",
  IN_PROGRESS: "قيد المتابعة",
  RESOLVED: "تم الحل",
  CLOSED: "مغلقة",
};

export const templateCategoryLabel: Record<string, string> = {
  GENERAL: "عام",
  WEDDING: "مناسبات وأفراح",
  CORPORATE: "شركات",
  ACADEMIC: "جامعات ومدارس",
  WORKSHOP: "ورش وتدريب",
  CLUB: "أندية ومجتمعات",
};

export const checkInMethodLabel: Record<string, string> = {
  SCAN: "مسح الرمز",
  MANUAL: "تسجيل يدوي",
};

export const jobStatusLabel: Record<string, string> = {
  PENDING: "مجدول",
  RUNNING: "قيد التنفيذ",
  DONE: "تم",
  FAILED: "فشل",
  CANCELLED: "ملغى",
};

export const walletTxLabel: Record<string, string> = {
  TOPUP: "شحن",
  DEBIT: "خصم",
  REFUND: "استرجاع",
  ADJUSTMENT: "تسوية",
};
