import { formatDateTime } from "@/lib/format";
import { SubmitButton } from "./client";

export function Thread({
  comments,
  action,
  hidden,
  viewerId,
  disabled,
}: {
  comments: { id: string; body: string; createdAt: Date; author: { id: string; name: string; role: string } }[];
  action: (fd: FormData) => Promise<void>;
  hidden: Record<string, string>;
  viewerId: string;
  disabled?: boolean;
}) {
  return (
    <div className="stack-sm">
      {comments.length === 0 ? <p className="small muted">لا توجد رسائل بعد.</p> : null}
      {comments.map((c) => (
        <div key={c.id} className={c.author.id === viewerId ? "card-flat" : "card-lilac"}>
          <div className="row-between small muted">
            <span>
              <strong style={{ color: "var(--plum)" }}>{c.author.name}</strong>
              {c.author.role === "ADMIN" ? " · فريق المنصة" : ""}
            </span>
            <span>{formatDateTime(c.createdAt)}</span>
          </div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{c.body}</div>
        </div>
      ))}
      {!disabled ? (
        <form action={action} className="stack-sm">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label htmlFor="body" className="sr-only">
            رسالتك
          </label>
          <textarea id="body" name="body" className="textarea" required placeholder="اكتب رسالتك…" style={{ minHeight: 80 }} />
          <div>
            <SubmitButton className="btn btn-dark btn-sm">إرسال</SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
