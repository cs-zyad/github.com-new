"use client";

import { useActionState } from "react";
import { confirmInvitationAction, declineInvitationAction } from "@/app/actions/guest";
import { ContactFields } from "@/components/ContactFields";
import { SubmitButton } from "@/components/client";
import { ResultBox } from "@/components/GuestShell";

export function RsvpForm({
  token,
  allowCompanion,
  fullPolicy,
  defaults,
  showDecline,
}: {
  token: string;
  allowCompanion: boolean;
  fullPolicy: string;
  defaults: { name: string; contactMethod: string; phone: string; email: string };
  showDecline: boolean;
}) {
  const [state, action] = useActionState(confirmInvitationAction, {});
  const v: Record<string, string> = { ...defaults, ...(state.values ?? {}) };

  if (state.outcome === "FULL") {
    return (
      <ResultBox tone="err" icon="!" title="اكتمل العدد">
        <p>نعتذر، اكتملت المقاعد المتاحة لهذه الفعالية.</p>
      </ResultBox>
    );
  }

  return (
    <div className="stack">
      {state.error ? (
        <div className="alert alert-err" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.outcome === "ONLY_ONE_LEFT" ? (
        <div className="alert alert-warn" role="alert">
          <strong>تبقّى مقعد واحد فقط.</strong> لا يمكن حجز مقعدين لك ولمرافقك. يمكنك تأكيد حضورك وحدك الآن
          {fullPolicy === "WAITLIST" ? "، أو الانتظار حتى يتوفر مقعد إضافي." : "."}
        </div>
      ) : null}
      <form action={action} className="stack">
        <input type="hidden" name="token" value={token} />
        <ContactFields defaults={v} />
        {state.outcome === "ONLY_ONE_LEFT" && fullPolicy === "WAITLIST" ? (
          <label className="check card-lilac">
            <input type="checkbox" name="joinWaitlist" />
            <span>
              أفضّل الانتظار مع مرافقي
              <span className="small muted" style={{ display: "block" }}>
                تنضم لقائمة الانتظار بطلب مقعدين بدل التأكيد وحدك الآن.
              </span>
            </span>
          </label>
        ) : null}
        {allowCompanion && state.outcome !== "ONLY_ONE_LEFT" ? (
          <label className="check card-lilac">
            <input type="checkbox" name="withCompanion" defaultChecked={v.withCompanion === "on"} />
            <span>
              معي مرافق
              <span className="small muted" style={{ display: "block" }}>
                يُحجز مقعدان، وتصلك تذكرتان مستقلتان: تذكرتك وتذكرة لمرافقك تشاركها معه.
              </span>
            </span>
          </label>
        ) : null}
        <SubmitButton className="btn btn-primary btn-lg btn-block" pendingText="جارٍ التأكيد…">
          {state.outcome === "ONLY_ONE_LEFT" ? (fullPolicy === "WAITLIST" ? "متابعة" : "أكّد حضوري وحدي") : "أكّد حضورك"}
        </SubmitButton>
      </form>
      {showDecline ? (
        <form action={declineInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="btn btn-ghost btn-block" confirm="تأكيد الاعتذار عن الحضور؟">
            أعتذر عن الحضور
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
