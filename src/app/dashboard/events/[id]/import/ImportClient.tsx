"use client";

import { useActionState, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { previewImportAction, recheckImportAction, commitImportAction, type ImportPreviewState } from "@/app/actions/events";
import type { ImportPreviewRow, ImportRow } from "@/services/invitations";
import { SubmitButton } from "@/components/client";

type Preview = NonNullable<ImportPreviewState["preview"]>;

const statusText: Record<string, { label: string; tone: string }> = {
  ACCEPTED: { label: "مقبول", tone: "ok" },
  DUPLICATE: { label: "مكرر", tone: "warn" },
  INVALID: { label: "يحتاج تصحيحًا", tone: "err" },
};

export function ImportClient({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [state, upload] = useActionState(previewImportAction, {});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL" | "BOTH">("WHATSAPP");
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (state.preview) {
      setPreview(state.preview);
      setRows(state.preview.rows);
      setMessage(null);
    }
  }, [state.preview]);

  const toRows = (list: ImportPreviewRow[]): ImportRow[] =>
    list.map(({ row, name, phone, email, companion }) => ({ row, name, phone, email, companion }));

  const update = (rowNo: number, key: keyof ImportRow, value: string) =>
    setRows((rs) => rs.map((r) => (r.row === rowNo ? { ...r, [key]: value } : r)));

  const recheck = () =>
    start(async () => {
      const p = await recheckImportAction(eventId, toRows(rows));
      setPreview(p);
      setRows(p.rows);
    });

  const exclude = (rowNo: number) => setRows((rs) => rs.filter((r) => r.row !== rowNo));

  const commit = () =>
    start(async () => {
      const r = await commitImportAction(eventId, toRows(rows), channel);
      if (!r.ok) {
        setMessage({ tone: "err", text: r.error });
        return;
      }
      setMessage({
        tone: "ok",
        text: `أُضيف ${r.added} مدعو. تُرك ${r.duplicates} مكرر و ${r.invalid} يحتاج تصحيحًا.`,
      });
      setPreview(null);
      setRows([]);
      router.refresh();
    });

  const accepted = rows.filter((r) => r.status === "ACCEPTED").length;
  const duplicates = rows.filter((r) => r.status === "DUPLICATE").length;
  const invalid = rows.filter((r) => r.status === "INVALID").length;

  return (
    <div className="stack">
      <form action={upload} className="card stack-sm">
        <input type="hidden" name="eventId" value={eventId} />
        <div className="field">
          <label htmlFor="file">ملف المدعوين</label>
          <input id="file" name="file" type="file" accept=".xlsx,.csv" className="input" required />
        </div>
        <div className="row">
          <SubmitButton className="btn btn-dark" pendingText="جارٍ القراءة…">
            معاينة الاستيراد
          </SubmitButton>
        </div>
        {state.error ? (
          <div className="alert alert-err" role="alert">
            {state.error}
          </div>
        ) : null}
      </form>

      {message ? (
        <div className={`alert alert-${message.tone}`} role="status">
          {message.text}{" "}
          {message.tone === "ok" ? <a href={`/dashboard/events/${eventId}/guests`}>عرض قائمة المدعوين</a> : null}
        </div>
      ) : null}

      {preview ? (
        <div className="stack">
          <div className="grid-3">
            <div className="stat">
              <div className="label">مقبول</div>
              <div className="value">{accepted}</div>
            </div>
            <div className="stat">
              <div className="label">مكرر (لن يُضاف)</div>
              <div className="value">{duplicates}</div>
            </div>
            <div className="stat">
              <div className="label">يحتاج تصحيحًا</div>
              <div className="value">{invalid}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الصف</th>
                  <th>الحالة</th>
                  <th>الاسم</th>
                  <th>الجوال</th>
                  <th>البريد</th>
                  <th>مرافق</th>
                  <th>ملاحظة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = statusText[r.status];
                  const editable = r.status !== "ACCEPTED";
                  return (
                    <tr key={r.row}>
                      <td className="num">{r.row}</td>
                      <td>
                        <span className={`badge badge-${st.tone}`}>{st.label}</span>
                      </td>
                      <td>
                        {editable ? (
                          <input className="input" value={r.name} onChange={(e) => update(r.row, "name", e.target.value)} aria-label="الاسم" style={{ minWidth: 140 }} />
                        ) : (
                          r.name
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <input className="input" type="tel" value={r.phone} onChange={(e) => update(r.row, "phone", e.target.value)} aria-label="الجوال" style={{ minWidth: 130 }} />
                        ) : (
                          <bdi className="ltr">{r.normalized?.phone ?? ""}</bdi>
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <input className="input" type="email" value={r.email} onChange={(e) => update(r.row, "email", e.target.value)} aria-label="البريد" style={{ minWidth: 160 }} />
                        ) : (
                          <bdi className="ltr">{r.normalized?.email ?? ""}</bdi>
                        )}
                      </td>
                      <td>{r.normalized ? (r.normalized.allowCompanion ? "نعم" : "لا") : r.companion}</td>
                      <td className="small">{r.reason ?? ""}</td>
                      <td>
                        {editable ? (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => exclude(r.row)}>
                            استبعاد
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card-lilac stack-sm">
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={recheck} disabled={pending}>
                إعادة التحقق بعد التصحيح
              </button>
              <span className="small muted">صحّح الصفوف أو استبعدها، ثم أعد التحقق.</span>
            </div>
            <div className="row">
              <label htmlFor="importChannel" className="label">
                قناة الإرسال للمستوردين:
              </label>
              <select id="importChannel" className="select" style={{ width: "auto" }} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
                <option value="WHATSAPP">واتساب</option>
                <option value="EMAIL">البريد</option>
                <option value="BOTH">واتساب والبريد</option>
              </select>
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={commit} disabled={pending || accepted === 0}>
                {pending ? "جارٍ الاعتماد…" : `اعتماد ${accepted} مدعو`}
              </button>
              {invalid > 0 ? <span className="small muted">الصفوف التي تحتاج تصحيحًا لن تُضاف حتى تُصحّح.</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
