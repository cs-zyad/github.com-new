import Link from "next/link";
import { TopBar } from "@/components/Shell";
import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "إنشاء حساب منظّم" };

export default function RegisterPage() {
  return (
    <>
      <TopBar user={null} home="/" />
      <main className="container narrow" style={{ padding: "2rem 16px 3rem" }}>
        <div className="card stack">
          <div>
            <h1>إنشاء حساب منظّم</h1>
            <p className="muted">للأفراد والأندية والجامعات والشركات ومراكز التدريب ومنظّمي المناسبات.</p>
          </div>
          <RegisterForm />
          <p className="small muted" style={{ margin: 0 }}>
            لديك حساب؟ <Link href="/login">سجّل الدخول</Link>
          </p>
        </div>
      </main>
    </>
  );
}
