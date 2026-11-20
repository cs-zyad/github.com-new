"use client";

import { useActionState } from "react";
import { setPasswordAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/client";

export function SetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(setPasswordAction, {});
  return (
    <form action={action} className="stack">
      {state.error ? (
        <div className="alert alert-err" role="alert">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="password">كلمة المرور</label>
        <input id="password" name="password" type="password" className="input" required minLength={8} autoComplete="new-password" />
        <span className="hint">8 أحرف على الأقل وتحتوي حروفًا وأرقامًا</span>
      </div>
      <div className="field">
        <label htmlFor="password2">تأكيد كلمة المرور</label>
        <input id="password2" name="password2" type="password" className="input" required autoComplete="new-password" />
      </div>
      <SubmitButton className="btn btn-primary btn-block btn-lg">حفظ والدخول</SubmitButton>
    </form>
  );
}
