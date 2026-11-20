import Link from "next/link";
import { brand } from "@/config/brand";
import { getCurrentUser } from "@/lib/auth";
import { TopBar } from "@/components/Shell";
import { LogoMark } from "@/components/Logo";

const features = [
  { t: "دعوة بقالب جاهز", d: "اختر قالبًا وعبّئ بيانات فعاليتك، وراجع المعاينة قبل الدفع والإرسال." },
  { t: "دعوات خاصة أو رابط عام", d: "أضف المدعوين أو استوردهم من Excel، أو انشر رابطًا عامًا ضمن السعة." },
  { t: "تأكيد ومرافق وانتظار", d: "حجز آمن للمقاعد، تذكرة مستقلة لكل شخص، وقائمة انتظار عند اكتمال العدد." },
  { t: "واتساب والبريد", d: "إرسال الدعوات والتذكيرات من رصيد مسبق بتكلفة واضحة قبل الإرسال." },
  { t: "مسح سريع عند الباب", d: "فريق الاستقبال يمسح QR من الجوال أو يسجّل الحضور يدويًا دون تكرار." },
  { t: "كشف حضور دقيق", d: "من دُعي، ومن أكّد، ومن حضر فعليًا — لحظيًا في لوحة واحدة." },
];

export default async function Home() {
  const user = await getCurrentUser();
  const home = user ? (user.role === "ADMIN" ? "/admin" : "/dashboard") : "/register";
  return (
    <>
      <TopBar user={user} home="/" />
      <section className="hero">
        <div className="container" style={{ display: "grid", gap: "1.5rem" }}>
          <LogoMark size={64} onDark />
          <div>
            <div className="tag">{brand.tagline}</div>
            <h1>من الدعوة إلى باب الفعالية — في منصة واحدة</h1>
            <p style={{ maxWidth: 620, opacity: 0.9 }}>
              {brand.nameAr} تربط تجهيز الدعوة وإرسالها بتأكيد الحضور وإصدار تذكرة QR وتسجيل الدخول عند الاستقبال. للأفراد والأندية والجامعات والشركات
              ومراكز التدريب ومنظّمي المناسبات.
            </p>
          </div>
          <div className="row">
            <Link href={home} className="btn btn-primary btn-lg">
              {user ? "افتح لوحتك" : "ابدأ كمنظّم"}
            </Link>
            {!user ? (
              <Link href="/login" className="btn btn-lg" style={{ background: "transparent", color: "var(--ivory)", borderColor: "rgba(255,255,255,.4)" }}>
                تسجيل الدخول
              </Link>
            ) : null}
          </div>
        </div>
      </section>
      <main className="container" style={{ padding: "2rem 16px 3rem" }}>
        <div className="grid-3">
          {features.map((f, i) => (
            <div key={f.t} className="feature">
              <div className="ico" aria-hidden>
                <span style={{ fontFamily: "var(--font-latin)", fontWeight: 700 }}>{i + 1}</span>
              </div>
              <h3>{f.t}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {f.d}
              </p>
            </div>
          ))}
        </div>
      </main>
      <footer className="footer">
        {brand.fullName} — {brand.tagline}
      </footer>
    </>
  );
}
