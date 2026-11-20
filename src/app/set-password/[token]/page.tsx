import { TopBar } from "@/components/Shell";
import { getSetPasswordToken } from "@/services/accounts";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "إنشاء كلمة المرور" };

export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rec = await getSetPasswordToken(token);
  return (
    <>
      <TopBar user={null} home="/" />
      <main className="container narrow" style={{ padding: "2rem 16px 3rem" }}>
        <div className="card stack">
          {rec ? (
            <>
              <div>
                <h1>مرحبًا {rec.user.name}</h1>
                <p className="muted">
                  أنشئ كلمة مرور لحسابك <bdi className="ltr">{rec.user.email}</bdi> لتبدأ العمل مع فريق الاستقبال.
                </p>
              </div>
              <SetPasswordForm token={token} />
            </>
          ) : (
            <div className="alert alert-err">الرابط منتهي أو مستخدم مسبقًا. اطلب من المنظّم إعادة إضافتك.</div>
          )}
        </div>
      </main>
    </>
  );
}
