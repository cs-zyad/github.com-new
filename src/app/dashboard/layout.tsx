import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/Shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  return (
    <AppShell
      user={user}
      nav={[
        { href: "/dashboard", label: "الفعاليات", exact: true },
        { href: "/dashboard/events/new", label: "فعالية جديدة" },
        { href: "/dashboard/wallet", label: "الرصيد والمدفوعات" },
        { href: "/dashboard/designs", label: "طلبات التصميم" },
        { href: "/dashboard/support", label: "الدعم" },
        { href: "/checkin", label: "التحضير" },
      ]}
    >
      {children}
    </AppShell>
  );
}
