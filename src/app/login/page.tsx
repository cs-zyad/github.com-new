import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { TopBar } from "@/components/Shell";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  return (
    <>
      <TopBar user={null} home="/" />
      <main className="container narrow" style={{ padding: "2rem 16px 3rem" }}>
        <div className="card stack">
          <div>
            <h1>تسجيل الدخول</h1>
            <p className="muted">للمنظّمين وفريق الاستقبال وأدمن المنصة.</p>
          </div>
          <LoginForm next={sp.next ?? ""} />
          <p className="small muted" style={{ margin: 0 }}>
            ليس لديك حساب؟ <Link href="/register">أنشئ حساب منظّم</Link>
          </p>
        </div>
        {env.demoMode ? (
          <div className="card-lilac small" style={{ marginTop: "1rem" }}>
            <strong>حسابات التجربة</strong> (كلمة المرور لجميعها: <bdi className="ltr">Wafda@2026</bdi>)
            <ul style={{ margin: "0.4rem 0 0", paddingInlineStart: "1.2rem" }}>
              <li>
                منظّم: <bdi className="ltr">organizer@wafda.test</bdi>
              </li>
              <li>
                فريق استقبال: <bdi className="ltr">staff@wafda.test</bdi>
              </li>
              <li>
                أدمن المنصة: <bdi className="ltr">admin@wafda.test</bdi>
              </li>
              <li>
                منظّم آخر (لاختبار العزل): <bdi className="ltr">other@wafda.test</bdi>
              </li>
              <li>
                عضو استقبال غير معيّن (لاختبار الصلاحيات): <bdi className="ltr">staff2@wafda.test</bdi>
              </li>
            </ul>
          </div>
        ) : null}
      </main>
    </>
  );
}
