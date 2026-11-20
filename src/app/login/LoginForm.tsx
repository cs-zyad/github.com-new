"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/client";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="stack">
      {state.error ? (
        <div className="alert alert-err" role="alert">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">البريد الإلكتروني</label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" defaultValue={state.values?.email} />
      </div>
      <div className="field">
        <label htmlFor="password">كلمة المرور</label>
        <input id="password" name="password" type="password" className="input" required autoComplete="current-password" />
      </div>
      <SubmitButton className="btn btn-primary btn-block btn-lg" pendingText="جارٍ الدخول…">
        دخول
      </SubmitButton>
    </form>
  );
}
