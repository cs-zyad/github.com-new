"use client";

import { useState } from "react";

/** الاسم + وسيلة تواصل واحدة يختارها الضيف (واتساب أو البريد) */
export function ContactFields({
  defaults,
}: {
  defaults: { name?: string; contactMethod?: string; phone?: string; email?: string };
}) {
  const [method, setMethod] = useState(defaults.contactMethod === "EMAIL" ? "EMAIL" : "WHATSAPP");
  return (
    <>
      <div className="field">
        <label htmlFor="g-name">الاسم</label>
        <input id="g-name" name="name" className="input" required minLength={2} maxLength={80} defaultValue={defaults.name} autoComplete="name" />
      </div>
      <fieldset>
        <legend>أين نرسل لك التذكرة؟</legend>
        <div className="choice-group">
          <label className="choice">
            <input type="radio" name="contactMethod" value="WHATSAPP" checked={method === "WHATSAPP"} onChange={() => setMethod("WHATSAPP")} />
            <span className="t">واتساب</span>
          </label>
          <label className="choice">
            <input type="radio" name="contactMethod" value="EMAIL" checked={method === "EMAIL"} onChange={() => setMethod("EMAIL")} />
            <span className="t">البريد الإلكتروني</span>
          </label>
        </div>
      </fieldset>
      {method === "WHATSAPP" ? (
        <div className="field">
          <label htmlFor="g-phone">رقم الجوال</label>
          <input id="g-phone" name="phone" type="tel" inputMode="tel" className="input" required placeholder="05xxxxxxxx" defaultValue={defaults.phone} autoComplete="tel" />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="g-email">البريد الإلكتروني</label>
          <input id="g-email" name="email" type="email" inputMode="email" className="input" required defaultValue={defaults.email} autoComplete="email" />
        </div>
      )}
    </>
  );
}
