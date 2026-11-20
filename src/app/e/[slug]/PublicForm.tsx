"use client";

import { useActionState } from "react";
import { registerPublicAction } from "@/app/actions/guest";
import { ContactFields } from "@/components/ContactFields";
import { SubmitButton } from "@/components/client";
import { ResultBox } from "@/components/GuestShell";

export function PublicForm({ slug, idem, waitlist }: { slug: string; idem: string; waitlist: boolean }) {
  const [state, action] = useActionState(registerPublicAction, {});
  if (state.outcome === "FULL") {
    return (
      <ResultBox tone="err" icon="!" title="اكتمل العدد">
        <p>نعتذر، اكتملت المقاعد قبل إتمام تسجيلك.</p>
      </ResultBox>
    );
  }
  if (state.outcome === "ALREADY_REGISTERED") {
    return (
      <ResultBox tone="info" icon="i" title="أنت مسجّل مسبقًا">
        <p>
          {state.waitlisted
            ? "وسيلة التواصل هذه مسجلة في قائمة الانتظار. سنبلغك إذا توفر مقعد."
            : state.resent
              ? "أعدنا إرسال التذكرة إلى وسيلة التواصل المسجلة."
              : "أرسلنا التذكرة مؤخرًا إلى وسيلة التواصل المسجلة. تحقق من رسائلك."}
        </p>
      </ResultBox>
    );
  }
  return (
    <form action={action} className="stack">
      {state.error ? (
        <div className="alert alert-err" role="alert">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="idem" value={idem} />
      <ContactFields defaults={state.values ?? {}} />
      <SubmitButton className="btn btn-primary btn-lg btn-block" pendingText="جارٍ التسجيل…">
        {waitlist ? "انضم لقائمة الانتظار" : "سجّل حضورك"}
      </SubmitButton>
    </form>
  );
}
