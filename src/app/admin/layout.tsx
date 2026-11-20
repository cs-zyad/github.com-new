import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/Shell";
import { ensureDbReady } from "@/lib/db";

export const metadata = { title: { default: "لوحة الأدمن", template: "%s | أدمن وفدة" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  await ensureDbReady();
  return (
    <AppShell
      user={user}
      home="/admin"
      nav={[
        { href: "/admin", label: "نظرة عامة", exact: true },
        { href: "/admin/users", label: "الحسابات" },
        { href: "/admin/templates", label: "القوالب" },
        { href: "/admin/designs", label: "طلبات التصميم" },
        { href: "/admin/support", label: "الشكاوى والدعم" },
        { href: "/admin/settings", label: "الباقات والتسعير" },
        { href: "/admin/payments", label: "المدفوعات" },
        { href: "/admin/messages", label: "الرسائل والتكلفة" },
        { href: "/admin/audit", label: "سجل التدقيق" },
      ]}
    >
      {children}
    </AppShell>
  );
}
