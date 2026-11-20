"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./client";
import type { FormState } from "@/lib/actions";

export type EventFormDefaults = {
  eventId?: string;
  title?: string;
  hostName?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  venueName?: string;
  venueAddress?: string;
  mapUrl?: string;
  mode?: string;
  capacity?: string;
  fullPolicy?: string;
};

export function EventForm({
  action,
  defaults = {},
  submitLabel,
  lockMode,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaults?: EventFormDefaults;
  submitLabel: string;
  lockMode?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const v = { ...defaults, ...(state.values ?? {}) } as EventFormDefaults;
  const [mode, setMode] = useState(v.mode ?? "PRIVATE");

  return (
    <form action={formAction} className="stack">
      {state.error ? (
        <div className="alert alert-err" role="alert">
          {state.error}
        </div>
      ) : null}
      {defaults.eventId ? <input type="hidden" name="eventId" value={defaults.eventId} /> : null}

      <div className="card stack">
        <h2>بيانات الفعالية</h2>
        <div className="field">
          <label htmlFor="title">اسم الفعالية</label>
          <input id="title" name="title" className="input" required minLength={3} maxLength={120} defaultValue={v.title} />
        </div>
        <div className="field">
          <label htmlFor="hostName">الجهة المنظّمة (تظهر في الدعوة)</label>
          <input id="hostName" name="hostName" className="input" maxLength={120} defaultValue={v.hostName} placeholder="مثال: نادي التقنية" />
        </div>
        <div className="field">
          <label htmlFor="description">الوصف (اختياري)</label>
          <textarea id="description" name="description" className="textarea" maxLength={2000} defaultValue={v.description} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="startsAt">موعد البداية</label>
            <input id="startsAt" name="startsAt" type="datetime-local" className="input" required defaultValue={v.startsAt} />
            <span className="hint">بتوقيت الرياض</span>
          </div>
          <div className="field">
            <label htmlFor="endsAt">موعد النهاية (اختياري)</label>
            <input id="endsAt" name="endsAt" type="datetime-local" className="input" defaultValue={v.endsAt} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="venueName">المكان</label>
            <input id="venueName" name="venueName" className="input" required defaultValue={v.venueName} placeholder="مثال: القاعة الكبرى" />
          </div>
          <div className="field">
            <label htmlFor="venueAddress">العنوان (اختياري)</label>
            <input id="venueAddress" name="venueAddress" className="input" defaultValue={v.venueAddress} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="mapUrl">رابط الخريطة (اختياري)</label>
          <input id="mapUrl" name="mapUrl" type="url" className="input ltr-input" defaultValue={v.mapUrl} placeholder="https://maps.google.com/..." />
        </div>
      </div>

      <div className="card stack">
        <h2>نوع الدعوة والسعة</h2>
        <fieldset disabled={lockMode}>
          <legend>نوع الدعوة</legend>
          <div className="choice-group">
            <label className="choice">
              <input type="radio" name="mode" value="PRIVATE" checked={mode === "PRIVATE"} onChange={() => setMode("PRIVATE")} />
              <span>
                <span className="t">دعوات خاصة بالاسم</span>
                <span className="d">تضيف المدعوين أو تستوردهم، وكل دعوة برابط خاص. الباقة حسب عدد المدعوين.</span>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="mode" value="PUBLIC" checked={mode === "PUBLIC"} onChange={() => setMode("PUBLIC")} />
              <span>
                <span className="t">رابط عام</span>
                <span className="d">رابط واحد يشاركه أي شخص ويسجّل ضمن السعة. الباقة حسب الحد الأقصى.</span>
              </span>
            </label>
          </div>
        </fieldset>
        {lockMode ? (
          <>
            <input type="hidden" name="mode" value={mode} />
            <span className="hint small muted">لا يمكن تغيير نوع الدعوة بعد دفع الباقة.</span>
          </>
        ) : null}
        <div className="field">
          <label htmlFor="capacity">الحد الأقصى للحضور (أشخاص)</label>
          <input id="capacity" name="capacity" type="number" min={1} max={100000} className="input ltr-input" required defaultValue={v.capacity} />
          <span className="hint">
            {mode === "PRIVATE"
              ? "عدد المقاعد التي يمكن حجزها عند التأكيد (المرافق يحجز مقعدًا)."
              : "عدد الأماكن في الباقة وعدد من يستطيع التسجيل من الرابط."}
          </span>
        </div>
        <fieldset>
          <legend>عند اكتمال العدد</legend>
          <div className="choice-group">
            <label className="choice">
              <input type="radio" name="fullPolicy" value="CLOSE" defaultChecked={(v.fullPolicy ?? "CLOSE") === "CLOSE"} />
              <span>
                <span className="t">إغلاق التسجيل</span>
                <span className="d">تظهر رسالة «اكتمل العدد».</span>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="fullPolicy" value="WAITLIST" defaultChecked={v.fullPolicy === "WAITLIST"} />
              <span>
                <span className="t">قائمة انتظار</span>
                <span className="d">تختار منها عند توفر مقعد.</span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <div className="form-actions">
        <SubmitButton className="btn btn-primary btn-lg">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
