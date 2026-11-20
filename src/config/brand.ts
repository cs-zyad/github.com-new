/**
 * هوية المنصة — غيّر الاسم أو العبارة أو الألوان من هنا فقط.
 * كل الواجهات والرسائل تقرأ من هذا الملف.
 */
export const brand = {
  nameAr: "وفدة",
  nameEn: "WAFDA",
  /** الاسم الكامل كما يظهر في العناوين والرسائل */
  fullName: "وفدة | WAFDA",
  tagline: "دعوة واضحة. حضور منظّم.",
  colors: {
    plum: "#28182C",
    lime: "#DDF480",
    ivory: "#FBF7EF",
    lilac: "#E8DEED",
    muted: "#65586B",
  },
  supportEmail: "support@wafda.example",
} as const;

export type Brand = typeof brand;
