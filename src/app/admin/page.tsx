import Link from "next/link";
import { prisma } from "@/lib/db";
import { providerStatus } from "@/providers/messaging";
import { env } from "@/lib/env";
import { Stat, Money, PageHeader, Badge } from "@/components/ui";

export default async function AdminHome() {
  const [users, events, activeEvents, paid, walletSpend, packageOps, pendingDesigns, openTickets, tickets, attended] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.event.count(),
    prisma.event.count({ where: { status: "ACTIVE" } }),
    prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.message.aggregate({ where: { billing: "WALLET", status: "SENT" }, _sum: { cost: true } }),
    prisma.message.aggregate({ where: { billing: "PACKAGE", status: "SENT" }, _sum: { operatingCost: true } }),
    prisma.designRequest.count({ where: { status: { in: ["SUBMITTED", "PAID", "IN_PROGRESS"] } } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.ticket.count({ where: { status: "ACTIVE" } }),
    prisma.ticket.count({ where: { checkedInAt: { not: null } } }),
  ]);
  const ps = providerStatus();
  return (
    <div className="stack">
      <PageHeader title="لوحة أدمن المنصة" subtitle="إدارة الحسابات والقوالب والطلبات والتسعير ومتابعة التشغيل." />
      <div className="grid-stats">
        <Stat label="المنظّمون" value={users} />
        <Stat label="الفعاليات" value={events} hint={`${activeEvents} نشطة`} />
        <Stat label="إجمالي المدفوع" value={<Money value={paid._sum.amount ?? 0} />} highlight />
        <Stat label="إيراد الرسائل (من الرصيد)" value={<Money value={walletSpend._sum.cost ?? 0} />} />
        <Stat label="تكلفة رسائل التأكيد (على الباقات)" value={<Money value={packageOps._sum.operatingCost ?? 0} />} hint="تقديرية" />
        <Stat label="التذاكر / الحضور" value={`${attended}/${tickets}`} />
      </div>
      <div className="grid-2">
        <div className="card stack-sm">
          <h3>بانتظار الإجراء</h3>
          <div className="row-between">
            <Link href="/admin/designs">طلبات تصميم بحاجة لمراجعة أو تنفيذ</Link>
            <Badge tone={pendingDesigns ? "warn" : "neutral"}>{pendingDesigns}</Badge>
          </div>
          <div className="row-between">
            <Link href="/admin/support">شكاوى وطلبات دعم مفتوحة</Link>
            <Badge tone={openTickets ? "warn" : "neutral"}>{openTickets}</Badge>
          </div>
        </div>
        <div className="card stack-sm">
          <h3>حالة الربط</h3>
          <div className="row-between">
            <span>واتساب</span>
            <Badge tone={ps.whatsappIsMock ? "warn" : "ok"}>{ps.whatsappIsMock ? "تجريبي (mock)" : ps.whatsapp}</Badge>
          </div>
          <div className="row-between">
            <span>البريد</span>
            <Badge tone={ps.emailIsMock ? "warn" : "ok"}>{ps.emailIsMock ? "تجريبي (mock)" : ps.email}</Badge>
          </div>
          <div className="row-between">
            <span>الدفع</span>
            <Badge tone={env.paymentProvider === "mock" ? "warn" : "ok"}>{env.paymentProvider === "mock" ? "تجريبي (mock)" : env.paymentProvider}</Badge>
          </div>
          <div className="row-between">
            <span>الوضع التجريبي</span>
            <Badge tone={env.demoMode ? "warn" : "ok"}>{env.demoMode ? "مفعّل" : "معطّل"}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
