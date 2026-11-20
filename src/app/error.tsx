"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="container narrow" style={{ padding: "4rem 16px", textAlign: "center" }}>
      <h1>حدث خطأ غير متوقع</h1>
      <p className="muted">حاول مرة أخرى. إن تكرر الخطأ تواصل مع دعم المنصة.</p>
      <button className="btn btn-primary" onClick={reset}>
        إعادة المحاولة
      </button>
    </main>
  );
}
