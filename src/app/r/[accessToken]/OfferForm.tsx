"use client";

import { useActionState } from "react";
import { claimOfferAction } from "@/app/actions/guest";
import { SubmitButton } from "@/components/client";

export function OfferForm({ accessToken, allowCompanion }: { accessToken: string; allowCompanion: boolean }) {
  const [state, action] = useActionState(claimOfferAction, {});
  return (
    <form action={action} className="stack">
      {state.error ? (
        <div className="alert alert-err" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.outcome === "ONLY_ONE_LEFT" ? (
        <div className="alert alert-warn">تبقّى مقعد واحد فقط. يمكنك تأكيد حضورك وحدك.</div>
      ) : null}
      <input type="hidden" name="accessToken" value={accessToken} />
      {allowCompanion && state.outcome !== "ONLY_ONE_LEFT" ? (
        <label className="check card-lilac">
          <input type="checkbox" name="withCompanion" defaultChecked />
          <span>معي مرافق (يُحجز مقعدان)</span>
        </label>
      ) : null}
      <SubmitButton className="btn btn-primary btn-lg btn-block" pendingText="جارٍ التأكيد…">
        أكّد حضورك
      </SubmitButton>
    </form>
  );
}
