import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./db";
import { confirmInvitation, registerPublic, cancelByGuest } from "@/services/rsvp";
import { requiredPrivatePlaces } from "@/services/events";
import { makeEvent, makeInvitation, makeUser, nextPhone, resetDb } from "./helpers";

beforeEach(resetDb);

describe("السعة والتزامن", () => {
  it("تسجيلات عامة متزامنة لا تتجاوز السعة", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 5, paidPlaces: 5 });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        registerPublic({
          slug: event.publicSlug!,
          contact: { name: `ضيف ${i}`, contactMethod: "WHATSAPP", phone: nextPhone() },
        }),
      ),
    );
    const confirmed = results.filter((r) => r.status === "CONFIRMED").length;
    const full = results.filter((r) => r.status === "FULL").length;
    expect(confirmed).toBe(5);
    expect(full).toBe(15);
    const fresh = await store.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.reservedSeats).toBe(5);
    expect(await store.ticket.count({ where: { eventId: event.id } })).toBe(5);
  });

  it("في العامة: السعة الفعلية لا تتجاوز الأماكن المدفوعة", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 10, paidPlaces: 3 });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        registerPublic({ slug: event.publicSlug!, contact: { name: `ضيف ${i}`, contactMethod: "WHATSAPP", phone: nextPhone() } }),
      ),
    );
    expect(results.filter((r) => r.status === "CONFIRMED").length).toBe(3);
  });

  it("سياسة قائمة الانتظار تضيف الزائدين للانتظار بدل الرفض", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 2, paidPlaces: 2, fullPolicy: "WAITLIST" });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        registerPublic({ slug: event.publicSlug!, contact: { name: `ضيف ${i}`, contactMethod: "EMAIL", email: `g${i}@x.com` } }),
      ),
    );
    expect(results.filter((r) => r.status === "CONFIRMED").length).toBe(2);
    expect(results.filter((r) => r.status === "WAITLISTED").length).toBe(3);
    expect(await store.ticket.count({ where: { eventId: event.id } })).toBe(2);
  });

  it("تأكيدات متزامنة لنفس الدعوة لا تكرر الحجز ولا التذاكر", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { capacity: 10 });
    const inv = await makeInvitation(event.id, { allowCompanion: true });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        confirmInvitation({
          token: inv.token,
          contact: { name: "خالد", contactMethod: "WHATSAPP", phone: "0551234567" },
          withCompanion: true,
        }),
      ),
    );
    expect(results.every((r) => r.status === "CONFIRMED")).toBe(true);
    expect(results.filter((r) => r.status === "CONFIRMED" && !r.already).length).toBe(1);
    const fresh = await store.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.reservedSeats).toBe(2);
    expect(await store.registration.count({ where: { eventId: event.id } })).toBe(1);
    expect(await store.ticket.count({ where: { eventId: event.id } })).toBe(2);
    expect(await store.message.count({ where: { eventId: event.id, kind: "CONFIRMATION" } })).toBe(1);
  });

  it("تأكيدات متزامنة من مدعوين مختلفين لا تتجاوز السعة (مع مرافقين)", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { capacity: 7 });
    const invs = await Promise.all(Array.from({ length: 8 }, () => makeInvitation(event.id, { allowCompanion: true })));
    const results = await Promise.all(
      invs.map((inv, i) =>
        confirmInvitation({
          token: inv.token,
          contact: { name: `مدعو ${i}`, contactMethod: "WHATSAPP", phone: nextPhone() },
          withCompanion: true,
        }),
      ),
    );
    const fresh = await store.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.reservedSeats).toBeLessThanOrEqual(7);
    const confirmedSeats = await store.registration.aggregate({ where: { eventId: event.id, status: "CONFIRMED" }, _sum: { seats: true } });
    expect(confirmedSeats._sum.seats).toBe(fresh.reservedSeats);
    expect(results.filter((r) => r.status === "CONFIRMED").length).toBe(3);
    // بقي مقعد واحد: طلبات المقعدين تحصل على حالة واضحة
    expect(results.some((r) => r.status === "ONLY_ONE_LEFT")).toBe(true);
  });

  it("مقعد واحد متبقٍ وطلب مقعدين: حالة واضحة ثم التأكيد منفردًا", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { capacity: 1 });
    const inv = await makeInvitation(event.id, { allowCompanion: true });
    const contact = { name: "خالد", contactMethod: "WHATSAPP" as const, phone: "0551234567" };
    const r1 = await confirmInvitation({ token: inv.token, contact, withCompanion: true });
    expect(r1.status).toBe("ONLY_ONE_LEFT");
    expect(await store.registration.count()).toBe(0);
    const r2 = await confirmInvitation({ token: inv.token, contact, withCompanion: false });
    expect(r2.status).toBe("CONFIRMED");
    expect(await store.ticket.count()).toBe(1);
  });

  it("الضغط المتكرر بنفس مفتاح النموذج في الرابط العام يعيد نفس التسجيل", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 10, paidPlaces: 10 });
    const contact = { name: "سارة", contactMethod: "WHATSAPP" as const, phone: "0501112222" };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => registerPublic({ slug: event.publicSlug!, contact, idempotencyKey: "form-key-12345" })),
    );
    const tokens = new Set(results.map((r) => ("accessToken" in r ? r.accessToken : null)));
    expect(tokens.size).toBe(1);
    expect(await store.registration.count()).toBe(1);
    expect((await store.event.findUniqueOrThrow({ where: { id: event.id } })).reservedSeats).toBe(1);
  });

  it("نفس وسيلة التواصل بنموذج جديد: لا تسجيل مكرر ولا كشف للتذكرة", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 10, paidPlaces: 10 });
    const contact = { name: "سارة", contactMethod: "WHATSAPP" as const, phone: "0501112222" };
    const a = await registerPublic({ slug: event.publicSlug!, contact, idempotencyKey: "key-aaaaaaaa" });
    const b = await registerPublic({ slug: event.publicSlug!, contact: { ...contact, phone: "+966501112222" }, idempotencyKey: "key-bbbbbbbb" });
    expect(a.status).toBe("CONFIRMED");
    expect(b.status).toBe("ALREADY_REGISTERED");
    expect("accessToken" in b).toBe(false);
    expect(await store.registration.count()).toBe(1);
    expect(await store.message.count({ where: { kind: "TICKET_RESEND" } })).toBe(1);
  });

  it("الاعتذار يحرر المقاعد ويلغي التذاكر", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { capacity: 5 });
    const inv = await makeInvitation(event.id, { allowCompanion: true });
    const r = await confirmInvitation({
      token: inv.token,
      contact: { name: "خالد", contactMethod: "WHATSAPP", phone: "0551234567" },
      withCompanion: true,
    });
    if (r.status !== "CONFIRMED") throw new Error("expected confirmed");
    await cancelByGuest(r.accessToken);
    await cancelByGuest(r.accessToken); // تكرار آمن
    const fresh = await store.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.reservedSeats).toBe(0);
    expect(await store.ticket.count({ where: { status: "ACTIVE" } })).toBe(0);
  });

  it("حساب أماكن الباقة: 40 دعوة منها 10 بمرافق = 50 مكانًا", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id);
    for (let i = 0; i < 40; i++) await makeInvitation(event.id, { allowCompanion: i < 10 });
    expect(await requiredPrivatePlaces(event.id)).toBe(50);
  });
});
