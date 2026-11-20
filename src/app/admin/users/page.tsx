import { adminUsers } from "@/services/queries";
import { formatDateTime } from "@/lib/format";
import { Flash, PageHeader, Badge, Money } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setUserStatusAction, adjustWalletAction } from "@/app/actions/admin";

export const metadata = { title: "الحسابات" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const users = await adminUsers(q);
  return (
    <div className="stack">
      <Flash sp={sp} />
      <PageHeader title="الحسابات" subtitle="المنظّمون وأعضاء فرق الاستقبال. الإيقاف ينهي جلسات الحساب فورًا." />
      <form className="row" action="/admin/users">
        <input name="q" className="input" placeholder="بحث بالاسم أو البريد" defaultValue={q} style={{ flex: "1 1 240px" }} />
        <button className="btn btn-sm">بحث</button>
      </form>
      <div className="list">
        {users.map((u) => (
          <div key={u.id} className="list-item stack-sm">
            <div className="row-between">
              <span className="title">
                {u.name}{" "}
                {u.role === "ADMIN" ? <Badge tone="att">أدمن</Badge> : null}{" "}
                <Badge tone={u.status === "ACTIVE" ? "ok" : u.status === "SUSPENDED" ? "err" : "warn"}>
                  {u.status === "ACTIVE" ? "نشط" : u.status === "SUSPENDED" ? "موقوف" : "مدعو"}
                </Badge>
              </span>
              <span className="small muted">{formatDateTime(u.createdAt)}</span>
            </div>
            <div className="small muted">
              <bdi className="ltr">{u.email}</bdi> · فعاليات {u._count.events} · فرق استقبال {u._count.staffAssignments} · الرصيد{" "}
              <Money value={u.wallet?.balance ?? 0} />
            </div>
            {u.role !== "ADMIN" ? (
              <div className="row">
                <form action={setUserStatusAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="status" value={u.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"} />
                  <SubmitButton
                    className={`btn btn-sm ${u.status === "SUSPENDED" ? "" : "btn-danger"}`}
                    confirm={u.status === "SUSPENDED" ? undefined : `إيقاف حساب ${u.name}؟`}
                  >
                    {u.status === "SUSPENDED" ? "تفعيل" : "إيقاف"}
                  </SubmitButton>
                </form>
                <details>
                  <summary className="btn btn-sm">تسوية الرصيد</summary>
                  <form action={adjustWalletAction} className="card-flat stack-sm" style={{ marginTop: 8 }}>
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="row">
                      <select name="direction" className="select" style={{ width: "auto" }}>
                        <option value="credit">إضافة</option>
                        <option value="debit">خصم</option>
                      </select>
                      <input name="amount" className="input ltr-input" placeholder="المبلغ بالريال" style={{ width: 140 }} required />
                    </div>
                    <input name="reason" className="input" placeholder="السبب (يُسجّل في التدقيق)" required />
                    <SubmitButton className="btn btn-sm btn-dark">تنفيذ</SubmitButton>
                  </form>
                </details>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
