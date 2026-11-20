import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./db";
import { registerPublic, cancelByGuest, claimOffer, confirmInvitation, getRegistrationByAccessToken } from "@/services/rsvp";
import { offerWaitlistSpot } from "@/services/sending";
import { makeEvent, makeInvitation, makeUser, resetDb, topUp } from "./helpers";

beforeEach(resetDb);

describe("قائمة الانتظار", () => {
  it("اعتذار ضيف ← المنظّم يختار من الانتظار ← التأكيد يحجز المقعد", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 1, paidPlaces: 1, fullPolicy: "WAITLIST" });
    const a = await registerPublic({ slug: event.publicSlug!, contact: { name: "أحمد", contactMethod: "WHATSAPP", phone: "0501000001" } });
    const b = await registerPublic({ slug: event.publicSlug!, contact: { name: "بدر", contactMethod: "WHATSAPP", phone: "0501000002" } });
    expect(a.status).toBe("CONFIRMED");
    expect(b.status).toBe("WAITLISTED");
    if (b.status !== "WAITLISTED" || a.status !== "CONFIRMED") throw new Error();
    const regB = await store.registration.findUniqueOrThrow({ where: { accessToken: b.accessToken } });

    // لا يمكن إرسال فرصة بلا مقعد متاح
    await expect(offerWaitlistSpot(owner.id, regB.id, "o1")).rejects.toThrow(/لا توجد مقاعد/);

    await cancelByGuest(a.accessToken);
    const offer = await offerWaitlistSpot(owner.id, regB.id, "o2");
    expect(offer.queued).toBe(1);
    expect((await store.registration.findUniqueOrThrow({ where: { id: regB.id } })).status).toBe("OFFERED");
    expect(await store.message.count({ where: { kind: "WAITLIST_OFFER" } })).toBe(1);

    const c = await claimOffer(b.accessToken, false);
    expect(c.status).toBe("CONFIRMED");
    const fresh = await store.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.reservedSeats).toBe(1);
    expect(await store.ticket.count({ where: { registrationId: regB.id, status: "ACTIVE" } })).toBe(1);
  });

  it("الفرصة لا تحجز المقعد: إن أُخذ قبل التأكيد يعود الشخص للانتظار", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id, { capacity: 1, fullPolicy: "WAITLIST" });
    const inv1 = await makeInvitation(event.id);
    const inv2 = await makeInvitation(event.id);
    const inv3 = await makeInvitation(event.id);
    const c1 = await confirmInvitation({ token: inv1.token, contact: { name: "ضيف1", contactMethod: "WHATSAPP", phone: "0502000001" }, withCompanion: false });
    const w2 = await confirmInvitation({ token: inv2.token, contact: { name: "ضيف2", contactMethod: "WHATSAPP", phone: "0502000002" }, withCompanion: false });
    expect(w2.status).toBe("WAITLISTED");
    if (c1.status !== "CONFIRMED" || w2.status !== "WAITLISTED") throw new Error();
    await cancelByGuest(c1.accessToken);
    const reg2 = await store.registration.findUniqueOrThrow({ where: { accessToken: w2.accessToken } });
    await offerWaitlistSpot(owner.id, reg2.id, "x");
    // مدعو آخر يؤكد قبل صاحب الفرصة
    const c3 = await confirmInvitation({ token: inv3.token, contact: { name: "ضيف3", contactMethod: "WHATSAPP", phone: "0502000003" }, withCompanion: false });
    expect(c3.status).toBe("CONFIRMED");
    const claim = await claimOffer(w2.accessToken, false);
    expect(claim.status).toBe("OFFER_UNAVAILABLE");
    expect((await store.registration.findUniqueOrThrow({ where: { id: reg2.id } })).status).toBe("WAITLISTED");
    expect((await store.event.findUniqueOrThrow({ where: { id: event.id } })).reservedSeats).toBe(1);
  });

  it("انتهاء صلاحية الفرصة يعيدها للانتظار", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id, { mode: "PUBLIC", capacity: 1, paidPlaces: 1, fullPolicy: "WAITLIST" });
    const a = await registerPublic({ slug: event.publicSlug!, contact: { name: "أحمد", contactMethod: "EMAIL", email: "a@x.com" } });
    const b = await registerPublic({ slug: event.publicSlug!, contact: { name: "بدر", contactMethod: "EMAIL", email: "b@x.com" } });
    if (a.status !== "CONFIRMED" || b.status !== "WAITLISTED") throw new Error();
    await cancelByGuest(a.accessToken);
    const regB = await store.registration.findUniqueOrThrow({ where: { accessToken: b.accessToken } });
    await offerWaitlistSpot(owner.id, regB.id, "x");
    await store.registration.update({ where: { id: regB.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
    const r = await claimOffer(b.accessToken, false);
    expect(r.status).toBe("OFFER_EXPIRED");
    const page = await getRegistrationByAccessToken(b.accessToken);
    expect(page.status).toBe("WAITLISTED");
  });

  it("مدعو بمرافق في الانتظار يستطيع التأكيد منفردًا إذا توفر مقعد واحد", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id, { capacity: 1, fullPolicy: "WAITLIST" });
    const inv1 = await makeInvitation(event.id);
    const inv2 = await makeInvitation(event.id, { allowCompanion: true });
    const c1 = await confirmInvitation({ token: inv1.token, contact: { name: "ضيف1", contactMethod: "WHATSAPP", phone: "0503000001" }, withCompanion: false });
    const w2 = await confirmInvitation({ token: inv2.token, contact: { name: "ضيف2", contactMethod: "WHATSAPP", phone: "0503000002" }, withCompanion: true });
    if (c1.status !== "CONFIRMED" || w2.status !== "WAITLISTED") throw new Error("unexpected");
    const reg2 = await store.registration.findUniqueOrThrow({ where: { accessToken: w2.accessToken } });
    expect(reg2.seatsRequested).toBe(2);
    await cancelByGuest(c1.accessToken);
    await offerWaitlistSpot(owner.id, reg2.id, "x");
    const withCompanion = await claimOffer(w2.accessToken, true);
    expect(withCompanion.status).toBe("ONLY_ONE_LEFT");
    expect((await store.registration.findUniqueOrThrow({ where: { id: reg2.id } })).status).toBe("OFFERED");
    const alone = await claimOffer(w2.accessToken, false);
    expect(alone.status).toBe("CONFIRMED");
    const fresh = await store.registration.findUniqueOrThrow({ where: { id: reg2.id } });
    expect(fresh.seats).toBe(1);
    expect(fresh.withCompanion).toBe(false);
  });

  it("مقعد واحد متبقٍ: المدعو يختار الانتظار مع مرافقه بدل التأكيد منفردًا", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id, { capacity: 2, fullPolicy: "WAITLIST" });
    const a = await makeInvitation(event.id);
    const b = await makeInvitation(event.id, { allowCompanion: true });
    await confirmInvitation({ token: a.token, contact: { name: "ضيف1", contactMethod: "WHATSAPP", phone: "0504000001" }, withCompanion: false });
    const contact = { name: "ضيف2", contactMethod: "WHATSAPP" as const, phone: "0504000002" };
    expect((await confirmInvitation({ token: b.token, contact, withCompanion: true })).status).toBe("ONLY_ONE_LEFT");
    const w = await confirmInvitation({ token: b.token, contact, withCompanion: true, joinWaitlist: true });
    expect(w.status).toBe("WAITLISTED");
    const reg = await store.registration.findFirstOrThrow({ where: { invitationId: b.id } });
    expect(reg.seatsRequested).toBe(2);
    expect((await store.event.findUniqueOrThrow({ where: { id: event.id } })).reservedSeats).toBe(1);
  });
});
