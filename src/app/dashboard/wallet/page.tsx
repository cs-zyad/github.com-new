import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { ensureWallet } from "@/services/wallet";
import { formatDateTime } from "@/lib/format";
import { walletTxLabel, paymentPurposeLabel, paymentStatusLabel } from "@/lib/labels";
import { Flash, Money, PageHeader, Badge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { topupAction } from "@/app/actions/account";

export const metadata = { title: "الرصيد والمدفوعات" };

export default async function WalletPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const wallet = await ensureWallet(user.id);
  const [txs, payments, settings] = await Promise.all([
    prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payment.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 50, include: { event: { select: { title: true } } } }),
    getSettings(),
  ]);
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader title="رصيد الرسائل والمدفوعات" subtitle="رصيد الرسائل منفصل عن باقة الفعالية، ويُخصم عند إرسال الدعوات والتذكيرات." />
      <div className="grid-2">
        <div className="card-plum stack-sm">
          <div className="small" style={{ color: "var(--lilac)" }}>
            الرصيد الحالي
          </div>
          <div style={{ fontSize: "2.2rem", fontWeight: 700, color: "var(--lime)" }}>
            <Money value={wallet.balance} />
          </div>
          <div className="small" style={{ color: "var(--lilac)" }}>
            سعر الرسالة: واتساب <Money value={settings.messagePrice.WHATSAPP} /> · البريد <Money value={settings.messagePrice.EMAIL} />
          </div>
        </div>
        <div className="card stack-sm">
          <h3>شحن الرصيد</h3>
          <form action={topupAction} className="stack-sm">
            <div className="row">
              {[50, 100, 250].map((v) => (
                <label key={v} className="choice" style={{ flex: "1 1 80px" }}>
                  <input type="radio" name="amount" value={v} defaultChecked={v === 100} />
                  <span className="t money">{v} ر.س</span>
                </label>
              ))}
            </div>
            <SubmitButton className="btn btn-primary">متابعة للدفع</SubmitButton>
            <span className="small muted">تثبيت الشحن يتم بعد تأكيد موثوق من مزوّد الدفع.</span>
          </form>
        </div>
      </div>

      <section className="stack-sm">
        <h2>حركة الرصيد</h2>
        {txs.length === 0 ? (
          <Empty>لا توجد حركات بعد.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th className="num">المبلغ</th>
                  <th className="num">الرصيد بعدها</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">{formatDateTime(t.createdAt)}</td>
                    <td>
                      <Badge tone={t.amount >= 0 ? "ok" : "neutral"}>{walletTxLabel[t.type]}</Badge>
                    </td>
                    <td>{t.description}</td>
                    <td className="num">
                      <Money value={t.amount} />
                    </td>
                    <td className="num">
                      <Money value={t.balanceAfter} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack-sm">
        <h2>المدفوعات</h2>
        {payments.length === 0 ? (
          <Empty>لا توجد مدفوعات بعد.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الغرض</th>
                  <th>الوصف</th>
                  <th className="num">المبلغ</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{formatDateTime(p.createdAt)}</td>
                    <td>{paymentPurposeLabel[p.purpose]}</td>
                    <td className="small">{p.description}</td>
                    <td className="num">
                      <Money value={p.amount} />
                    </td>
                    <td>
                      <Badge tone={p.status === "PAID" ? "ok" : p.status === "PENDING" ? "warn" : "neutral"}>{paymentStatusLabel[p.status]}</Badge>
                    </td>
                    <td>
                      {p.status === "PENDING" && p.provider === "mock" ? (
                        <Link href={`/dev/checkout/${p.id}`} className="btn btn-sm">
                          إكمال الدفع
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
