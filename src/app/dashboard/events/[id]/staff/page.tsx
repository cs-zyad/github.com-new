import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOwnedEvent } from "@/services/events";
import { listStaff } from "@/services/staff";
import { links } from "@/services/presentation";
import { Flash, Badge, Empty } from "@/components/ui";
import { SubmitButton, CopyField } from "@/components/client";
import { addStaffAction, removeStaffAction } from "@/app/actions/events";

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const event = await getOwnedEvent(id, user.id);
  const staff = await listStaff(event.id);
  return (
    <div className="stack">
      <Flash sp={sp} />
      <div className="card-lilac stack-sm">
        <strong>صفحة التحضير لهذه الفعالية</strong>
        <p className="small muted" style={{ margin: 0 }}>
          أعضاء الفريق يفتحونها من الجوال بعد تسجيل الدخول. صلاحيتهم مقتصرة على المسح والتحضير لهذه الفعالية فقط.
        </p>
        <CopyField text={links.checkin(event.id)} />
        <div>
          <Link href={`/checkin/${event.id}`} className="btn btn-dark btn-sm">
            افتح التحضير الآن
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <div className="card stack-sm">
          <h3>إضافة عضو لفريق الاستقبال</h3>
          <form action={addStaffAction} className="stack-sm">
            <input type="hidden" name="eventId" value={event.id} />
            <div className="field">
              <label htmlFor="sname">الاسم</label>
              <input id="sname" name="name" className="input" required />
            </div>
            <div className="field">
              <label htmlFor="semail">البريد الإلكتروني</label>
              <input id="semail" name="email" type="email" className="input" required />
              <span className="hint">إن لم يكن لديه حساب يصله رابط لإنشاء كلمة المرور.</span>
            </div>
            <SubmitButton className="btn btn-primary">إضافة ومنح صلاحية التحضير</SubmitButton>
          </form>
        </div>
        <div className="card stack-sm">
          <h3>الفريق الحالي</h3>
          {staff.length === 0 ? (
            <Empty>لا يوجد أعضاء بعد. أنت (المنظّم) تستطيع التحضير دائمًا.</Empty>
          ) : (
            <div className="list">
              {staff.map((s) => (
                <div key={s.id} className="row-between list-item">
                  <div>
                    <div className="title">{s.user.name}</div>
                    <div className="small muted">
                      <bdi className="ltr">{s.user.email}</bdi>{" "}
                      {s.user.status === "INVITED" ? <Badge tone="warn">لم يُنشئ كلمة المرور بعد</Badge> : <Badge tone="ok">نشط</Badge>}
                    </div>
                  </div>
                  <form action={removeStaffAction}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="userId" value={s.user.id} />
                    <SubmitButton className="btn btn-sm btn-danger" confirm={`إزالة ${s.user.name} من فريق هذه الفعالية؟`}>
                      إزالة
                    </SubmitButton>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
