"use client";

import { useActionState } from "react";
import { registerAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/client";

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="stack">
      {state.error ? (
        <div className="alert alert-err" role="alert">
          {state.error}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="name">الاسم أو اسم الجهة</label>
        <input id="name" name="name" className="input" required defaultValue={v.name} autoComplete="organization" />
      </div>
      <div className="field">
        <label htmlFor="email">البريد الإلكتروني</label>
        <input id="email" name="email" type="email" className="input" required defaultValue={v.email} autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="phone">رقم الجوال (اختياري)</label>
        <input id="phone" name="phone" type="tel" className="input" placeholder="05xxxxxxxx" defaultValue={v.phone} autoComplete="tel" />
      </div>
      <div className="field">
        <label htmlFor="password">كلمة المرور</label>
        <input id="password" name="password" type="password" className="input" required minLength={8} autoComplete="new-password" />
        <span className="hint">8 أحرف على الأقل وتحتوي حروفًا وأرقامًا</span>
      </div>
      <SubmitButton className="btn btn-primary btn-block btn-lg" pendingText="جارٍ إنشاء الحساب…">
        إنشاء الحساب
      </SubmitButton>
    </form>
  );
}
