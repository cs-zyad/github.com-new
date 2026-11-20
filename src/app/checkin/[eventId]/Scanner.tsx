"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { formatTime } from "@/lib/format";

type Result =
  | {
      result: "SUCCESS" | "ALREADY";
      holderName: string;
      kind: string;
      primaryName: string;
      checkedInAt: string;
      method: string;
    }
  | { result: "INVALID" | "WRONG_EVENT" | "CANCELLED" | "ERROR"; message: string };

type SearchItem = {
  ticketId: string;
  kind: string;
  holderName: string;
  primaryName: string;
  phone: string | null;
  email: string | null;
  checkedInAt: string | null;
  checkInMethod: string | null;
  checkedInBy: string | null;
};

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

const methodText: Record<string, string> = { SCAN: "بالمسح", MANUAL: "يدويًا" };

export function Scanner({ eventId, initialAttended, totalTickets }: { eventId: string; initialAttended: number; totalTickets: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "error">("off");
  const [cameraError, setCameraError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [attended, setAttended] = useState(initialAttended);
  const [manualCode, setManualCode] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  const submit = useCallback(
    async (payload: { raw?: string; ticketId?: string; method: "SCAN" | "MANUAL" }) => {
      busyRef.current = true;
      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, ...payload }),
        });
        const data = (await res.json()) as Result;
        setResult(data);
        if (data.result === "SUCCESS") {
          setAttended((n) => n + 1);
          navigator.vibrate?.(120);
        } else {
          navigator.vibrate?.([60, 60, 60]);
        }
        return data;
      } catch {
        const r: Result = { result: "ERROR", message: "تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى." };
        setResult(r);
        return r;
      } finally {
        setTimeout(() => (busyRef.current = false), 1200);
      }
    },
    [eventId],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera("off");
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCamera("error");
      setCameraError("الكاميرا تحتاج اتصالًا آمنًا (HTTPS). استخدم البحث أو أدخل الرمز يدويًا.");
      return;
    }
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
      if (BD) {
        try {
          detectorRef.current = new BD({ formats: ["qr_code"] });
        } catch {
          detectorRef.current = null;
        }
      }
      setCamera("on");
    } catch (e) {
      setCamera("error");
      const name = e instanceof Error ? e.name : "";
      setCameraError(
        name === "NotAllowedError"
          ? "لم يُسمح باستخدام الكاميرا. فعّل الإذن من إعدادات المتصفح، أو استخدم البحث اليدوي."
          : "تعذّر تشغيل الكاميرا. استخدم البحث اليدوي أو أدخل الرمز.",
      );
    }
  }, []);

  // حلقة المسح
  useEffect(() => {
    if (camera !== "on") return;
    let raf = 0;
    let lastTick = 0;
    const loop = async (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - lastTick < 180 || busyRef.current) return;
      lastTick = t;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      let raw: string | null = null;
      try {
        if (detectorRef.current) {
          const codes = await detectorRef.current.detect(video);
          raw = codes[0]?.rawValue ?? null;
        } else {
          const canvas = canvasRef.current!;
          const w = 480;
          const h = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          raw = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
        }
      } catch {
        raw = null;
      }
      if (!raw) return;
      const now = Date.now();
      if (raw === lastRef.current.code && now - lastRef.current.at < 3500) return;
      lastRef.current = { code: raw, at: now };
      await submit({ raw, method: "SCAN" });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camera, submit]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // البحث اليدوي
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems(null);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/checkin/search?eventId=${encodeURIComponent(eventId)}&q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setItems(data.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, eventId]);

  const manualCheckIn = async (ticketId: string) => {
    const r = await submit({ ticketId, method: "MANUAL" });
    if (r.result === "SUCCESS" || r.result === "ALREADY") {
      setItems((list) =>
        list?.map((i) => (i.ticketId === ticketId ? { ...i, checkedInAt: r.checkedInAt, checkInMethod: r.method } : i)) ?? null,
      );
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="stat highlight">
          <div className="label">الحاضرون</div>
          <div className="value" aria-live="polite">
            {attended}
          </div>
          <div className="hint">من {totalTickets} تذكرة صالحة</div>
        </div>
        <div className="stat">
          <div className="label">الكاميرا</div>
          <div style={{ marginTop: 4 }}>
            {camera === "on" ? (
              <button className="btn btn-sm" onClick={stopCamera}>
                إيقاف الكاميرا
              </button>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={startCamera} disabled={camera === "starting"}>
                {camera === "starting" ? "جارٍ التشغيل…" : "تشغيل الكاميرا"}
              </button>
            )}
          </div>
        </div>
      </div>

      {result ? <ResultPanel r={result} /> : null}

      <div className="scanner" style={{ display: camera === "on" || camera === "starting" ? "block" : "none" }}>
        <video ref={videoRef} playsInline muted />
        <div className="frame">
          <span />
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {camera === "off" ? (
        <button className="btn btn-dark btn-lg btn-block" onClick={startCamera}>
          ابدأ المسح بالكاميرا
        </button>
      ) : null}
      {cameraError ? (
        <div className="alert alert-warn" role="alert">
          {cameraError}
        </div>
      ) : null}

      <div className="card stack-sm">
        <h2 style={{ margin: 0 }}>تعذّر عرض الرمز؟</h2>
        <p className="small muted" style={{ margin: 0 }}>
          ابحث عن الضيف بالاسم أو رقم الجوال أو البريد الإلكتروني ضمن هذه الفعالية، ثم سجّل حضوره يدويًا.
        </p>
        <input
          className="input"
          placeholder="الاسم أو الجوال أو البريد"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="بحث عن ضيف"
          inputMode="search"
        />
        {searching ? <div className="small muted">جارٍ البحث…</div> : null}
        {items && items.length === 0 && !searching ? <div className="small muted">لا توجد نتائج مؤكدة بهذا البحث.</div> : null}
        {items?.length ? (
          <div className="list">
            {items.map((i) => (
              <div key={i.ticketId} className="list-item row-between">
                <div>
                  <div className="title">{i.kind === "COMPANION" ? `مرافق — ${i.primaryName}` : i.holderName}</div>
                  <div className="small muted">
                    {i.kind === "COMPANION" ? "تذكرة مرافق · " : ""}
                    {i.phone ? <bdi className="ltr">{i.phone}</bdi> : null} {i.email ? <bdi className="ltr">{i.email}</bdi> : null}
                  </div>
                  {i.checkedInAt ? (
                    <span className="badge badge-att">
                      حضر مسبقًا {formatTime(i.checkedInAt)} {methodText[i.checkInMethod ?? "SCAN"]}
                    </span>
                  ) : null}
                </div>
                {!i.checkedInAt ? (
                  <button className="btn btn-sm btn-primary" onClick={() => manualCheckIn(i.ticketId)}>
                    تسجيل الحضور يدويًا
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <details className="box">
        <summary>إدخال رمز التذكرة يدويًا</summary>
        <form
          className="row"
          style={{ marginTop: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (manualCode.trim()) await submit({ raw: manualCode.trim(), method: "SCAN" });
            setManualCode("");
          }}
        >
          <input
            className="input ltr-input"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="W1… أو رابط التذكرة"
            aria-label="رمز التذكرة"
            style={{ flex: "1 1 200px" }}
          />
          <button className="btn btn-dark">تحقق</button>
        </form>
      </details>
    </div>
  );
}

function ResultPanel({ r }: { r: Result }) {
  if (r.result === "SUCCESS" || r.result === "ALREADY") {
    const who = r.kind === "COMPANION" ? `مرافق — ${r.primaryName}` : r.holderName;
    return (
      <div className={`scan-result scan-${r.result}`} role="status" aria-live="assertive">
        <div className="big">{r.result === "SUCCESS" ? "✓ تم تسجيل الدخول" : "⚠ حضر مسبقًا"}</div>
        <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>{who}</div>
        <div className="small">
          {r.kind === "COMPANION" ? "تذكرة مرافق · " : ""}
          {r.result === "SUCCESS" ? "وقت الدخول" : "سُجّل دخوله"} {formatTime(r.checkedInAt)} {methodText[r.method] ?? ""}
        </div>
      </div>
    );
  }
  const title = r.result === "WRONG_EVENT" ? "✕ تذكرة لفعالية أخرى" : r.result === "CANCELLED" ? "✕ تذكرة ملغاة" : r.result === "INVALID" ? "✕ رمز غير صالح" : "✕ خطأ";
  return (
    <div className={`scan-result scan-${r.result}`} role="alert" aria-live="assertive">
      <div className="big">{title}</div>
      <div className="small">{"message" in r ? r.message : ""}</div>
    </div>
  );
}
