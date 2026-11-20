import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="container narrow" style={{ padding: "4rem 16px", textAlign: "center" }}>
      <Logo size={36} />
      <h1 style={{ marginTop: "1.5rem" }}>الصفحة غير موجودة</h1>
      <p className="muted">قد يكون الرابط غير صحيح أو انتهت صلاحيته.</p>
      <Link href="/" className="btn btn-primary">
        الرئيسية
      </Link>
    </main>
  );
}
