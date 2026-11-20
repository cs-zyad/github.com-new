import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./db";
import { buildMockWebhook } from "@/providers/payments/mock";
import { handlePaymentWebhook, startPackageCheckout, startExtraPlacesCheckout, startTopupCheckout } from "@/services/payments";
import { quotePackage } from "@/services/pricing";
import { getBalance } from "@/services/wallet";
import { makeEvent, makeInvitation, makeTemplate, makeUser, resetDb, seedPlans } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedPlans();
});

async function paySucceeded(paymentId: string, eventId?: string) {
  const p = await store.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const wh = buildMockWebhook({
    providerRef: p.providerRef!,
    paymentId: p.id,
    amount: p.amount,
    currency: p.currency,
    type: "payment.succeeded",
    eventId,
  });
  return { wh, result: await handlePaymentWebhook(wh.rawBody, wh.headers, "mock") };
}

describe("الباقات والدفع", () => {
  it("حساب الباقة الخاصة: أصغر باقة تغطي العدد", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { status: "DRAFT", paidPlaces: 0 });
    for (let i = 0; i < 40; i++) await makeInvitation(event.id, { allowCompanion: i < 10 });
    const q = await quotePackage(event);
    expect(q.kind).toBe("PACKAGE");
    if (q.kind === "PACKAGE") {
      expect(q.needed).toBe(50);
      expect(q.plan.places).toBe(50);
      expect(q.amount).toBe(9900);
    }
  });

  it("عدد أكبر من أكبر باقة يضيف أماكن بسعر المكان الإضافي", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 300, status: "DRAFT", paidPlaces: 0 });
    const q = await quotePackage(event);
    if (q.kind !== "PACKAGE") throw new Error("expected package");
    expect(q.plan.places).toBe(250);
    expect(q.extraPlaces).toBe(50);
    expect(q.amount).toBe(39900 + 50 * 200);
    expect(q.places).toBe(300);
  });

  it("الدفع يُثبّت فقط بإشعار موثّق، والإشعار المكرر لا يكرر الأماكن", async () => {
    const owner = await makeUser();
    const tpl = await makeTemplate();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 40, status: "DRAFT", paidPlaces: 0, templateId: tpl.id });
    const { payment } = await startPackageCheckout(owner.id, event.id);
    expect(payment.places).toBe(50);
    // قبل الإشعار: لم يتغير شيء
    expect((await store.event.findUniqueOrThrow({ where: { id: event.id } })).paidPlaces).toBe(0);

    const first = await paySucceeded(payment.id, "evt_same_1");
    expect(first.result.outcome).toBe("PROCESSED");
    const again = await handlePaymentWebhook(first.wh.rawBody, first.wh.headers, "mock");
    expect(again.outcome).toBe("DUPLICATE");
    // إشعار مختلف لنفس العملية (إعادة إرسال من المزوّد بمعرّف جديد)
    const other = await paySucceeded(payment.id, "evt_other_2");
    expect(other.result.outcome).toBe("IGNORED");

    const fresh = await store.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.paidPlaces).toBe(50);
    expect(fresh.status).toBe("ACTIVE");
    expect(fresh.publicSlug).toBeTruthy();
    expect(fresh.publishedAt).toBeTruthy();
  });

  it("إشعارات متزامنة مكررة تُطبّق مرة واحدة", async () => {
    const owner = await makeUser();
    const tpl = await makeTemplate();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 40, status: "DRAFT", paidPlaces: 0, templateId: tpl.id });
    const { payment } = await startPackageCheckout(owner.id, event.id);
    const wh = buildMockWebhook({
      providerRef: payment.providerRef!,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      type: "payment.succeeded",
      eventId: "evt_concurrent",
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => handlePaymentWebhook(wh.rawBody, wh.headers, "mock")));
    expect(results.filter((r) => r.outcome === "PROCESSED").length).toBe(1);
    expect((await store.event.findUniqueOrThrow({ where: { id: event.id } })).paidPlaces).toBe(50);
  });

  it("رفض التوقيع غير الصحيح والمبلغ غير المطابق", async () => {
    const owner = await makeUser();
    const { payment } = await startTopupCheckout(owner.id, 5000);
    const wh = buildMockWebhook({
      providerRef: payment.providerRef!,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      type: "payment.succeeded",
    });
    const tampered = await handlePaymentWebhook(wh.rawBody.replace('"amount":5000', '"amount":999999'), wh.headers, "mock");
    expect(tampered.outcome).toBe("REJECTED");
    const wrongAmount = buildMockWebhook({
      providerRef: payment.providerRef!,
      paymentId: payment.id,
      amount: 1,
      currency: payment.currency,
      type: "payment.succeeded",
    });
    expect((await handlePaymentWebhook(wrongAmount.rawBody, wrongAmount.headers, "mock")).outcome).toBe("REJECTED");
    expect(await getBalance(owner.id)).toBe(0);
  });

  it("شحن الرصيد يُضاف مرة واحدة رغم تكرار الإشعار", async () => {
    const owner = await makeUser();
    const { payment } = await startTopupCheckout(owner.id, 5000);
    const a = await paySucceeded(payment.id, "evt_topup");
    await handlePaymentWebhook(a.wh.rawBody, a.wh.headers, "mock");
    await paySucceeded(payment.id, "evt_topup_retry");
    expect(await getBalance(owner.id)).toBe(5000);
    expect(await store.walletTransaction.count({ where: { type: "TOPUP" } })).toBe(1);
  });

  it("الأماكن الإضافية بعد الدفع ترفع الاستحقاق (والسعة في العامة)", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 50, paidPlaces: 50 });
    const { payment } = await startExtraPlacesCheckout(owner.id, event.id, 10);
    expect(payment.amount).toBe(10 * 200);
    await paySucceeded(payment.id);
    const fresh = await store.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.paidPlaces).toBe(60);
    expect(fresh.capacity).toBe(60);
  });

  it("لا دفع قبل اختيار القالب أو إضافة المدعوين", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { status: "DRAFT", paidPlaces: 0 });
    await expect(startPackageCheckout(owner.id, event.id)).rejects.toThrow(/قالب/);
    const tpl = await makeTemplate();
    await store.event.update({ where: { id: event.id }, data: { templateId: tpl.id } });
    await expect(startPackageCheckout(owner.id, event.id)).rejects.toThrow(/المدعوين/);
  });
});
