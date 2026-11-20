import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmInvitation, registerPublic, cancelByGuest } from "@/services/rsvp";
import { checkIn, searchTickets, extractTicketCode } from "@/services/checkin";
import { ForbiddenError } from "@/lib/errors";
import { makeEvent, makeInvitation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function setupConfirmedWithCompanion() {
  const owner = await makeUser({ name: "المنظّم" });
  const staff = await makeUser({ name: "عضو الاستقبال" });
  const outsider = await makeUser({ name: "غير معيّن" });
  const event = await makeEvent(owner.id, { capacity: 10 });
  await prisma.eventStaff.create({ data: { eventId: event.id, userId: staff.id, addedById: owner.id } });
  const inv = await makeInvitation(event.id, { allowCompanion: true, name: "خالد الحربي" });
  const r = await confirmInvitation({
    token: inv.token,
    contact: { name: "خالد الحربي", contactMethod: "WHATSAPP", phone: "0551234567" },
    withCompanion: true,
  });
  if (r.status !== "CONFIRMED") throw new Error("expected confirmed");
  const tickets = await prisma.ticket.findMany({ where: { eventId: event.id }, orderBy: { kind: "desc" } });
  return { owner, staff, outsider, event, inv, tickets, accessToken: r.accessToken };
}

describe("تسجيل الحضور", () => {
  it("رمزا المدعو والمرافق مستقلان ويعملان كلٌّ بوقته", async () => {
    const { staff, event, tickets } = await setupConfirmedWithCompanion();
    const [primary, companion] = tickets;
    expect(primary.kind).toBe("PRIMARY");
    expect(companion.kind).toBe("COMPANION");
    expect(primary.code).not.toBe(companion.code);
    expect(companion.holderName).toBe("مرافق");

    const a = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: primary.code });
    expect(a.result).toBe("SUCCESS");
    const stillOut = await prisma.ticket.findUniqueOrThrow({ where: { id: companion.id } });
    expect(stillOut.checkedInAt).toBeNull();
    const b = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: companion.code });
    expect(b.result).toBe("SUCCESS");
    if (b.result === "SUCCESS") expect(b.primaryName).toBe("خالد الحربي");
  });

  it("المسح المكرر والتسجيل اليدوي لا يكرران الحضور", async () => {
    const { staff, event, tickets } = await setupConfirmedWithCompanion();
    const t = tickets[0];
    const first = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: t.code });
    const second = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: t.code });
    const manual = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "MANUAL", ticketId: t.id });
    expect(first.result).toBe("SUCCESS");
    expect(second.result).toBe("ALREADY");
    expect(manual.result).toBe("ALREADY");
    if (second.result === "ALREADY" && first.result === "SUCCESS") {
      expect(second.checkedInAt.getTime()).toBe(first.checkedInAt.getTime());
      expect(second.method).toBe("SCAN");
    }
    const fresh = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(fresh.checkInMethod).toBe("SCAN");
  });

  it("مسحات متزامنة لنفس الرمز تسجل حضورًا واحدًا فقط", async () => {
    const { staff, owner, event, tickets } = await setupConfirmedWithCompanion();
    const t = tickets[0];
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        checkIn({ staffUserId: i % 2 ? staff.id : owner.id, eventId: event.id, method: i % 3 ? "SCAN" : "MANUAL", code: t.code }),
      ),
    );
    expect(results.filter((r) => r.result === "SUCCESS").length).toBe(1);
    expect(results.filter((r) => r.result === "ALREADY").length).toBe(7);
  });

  it("التسجيل اليدوي أولًا ثم المسح يظهر حضر مسبقًا", async () => {
    const { staff, event, tickets } = await setupConfirmedWithCompanion();
    const t = tickets[1];
    const m = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "MANUAL", ticketId: t.id });
    const s = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: t.code });
    expect(m.result).toBe("SUCCESS");
    expect(s.result).toBe("ALREADY");
    const fresh = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(fresh.checkedInById).toBe(staff.id);
    expect(fresh.checkInMethod).toBe("MANUAL");
  });

  it("عضو غير معيّن على الفعالية لا يستطيع المسح أو البحث", async () => {
    const { outsider, event, tickets } = await setupConfirmedWithCompanion();
    await expect(checkIn({ staffUserId: outsider.id, eventId: event.id, method: "SCAN", code: tickets[0].code })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(searchTickets(outsider.id, event.id, "خالد")).rejects.toBeInstanceOf(ForbiddenError);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(t.checkedInAt).toBeNull();
  });

  it("عضو الفريق مقيّد بفعاليته: تذكرة فعالية أخرى تظهر خطأ دون كشف بياناتها", async () => {
    const { staff, event } = await setupConfirmedWithCompanion();
    const other = await makeUser();
    const otherEvent = await makeEvent(other.id, { mode: "PUBLIC", capacity: 5, paidPlaces: 5 });
    await registerPublic({ slug: otherEvent.publicSlug!, contact: { name: "نورة", contactMethod: "EMAIL", email: "n@x.com" } });
    const foreign = await prisma.ticket.findFirstOrThrow({ where: { eventId: otherEvent.id } });
    const r = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: foreign.code });
    expect(r.result).toBe("WRONG_EVENT");
    expect("holderName" in r).toBe(false);
    // ولا يستطيع العمل على الفعالية الأخرى
    await expect(checkIn({ staffUserId: staff.id, eventId: otherEvent.id, method: "SCAN", code: foreign.code })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // البحث لا يعيد سجلات من فعاليات أخرى
    const found = await searchTickets(staff.id, event.id, "نورة");
    expect(found.length).toBe(0);
  });

  it("رمز غير صالح وتذكرة ملغاة", async () => {
    const { staff, event, tickets, accessToken } = await setupConfirmedWithCompanion();
    const bad = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: "W1doesnotexist_doesnotexist" });
    expect(bad.result).toBe("INVALID");
    await cancelByGuest(accessToken);
    const r = await checkIn({ staffUserId: staff.id, eventId: event.id, method: "SCAN", code: tickets[0].code });
    expect(r.result).toBe("CANCELLED");
  });

  it("البحث بالاسم أو الجوال أو البريد داخل الفعالية", async () => {
    const { staff, event } = await setupConfirmedWithCompanion();
    expect((await searchTickets(staff.id, event.id, "خالد")).length).toBe(2); // المدعو + المرافق
    expect((await searchTickets(staff.id, event.id, "0551234567")).length).toBe(2);
    expect((await searchTickets(staff.id, event.id, "1234567")).length).toBe(2);
    expect((await searchTickets(staff.id, event.id, "غير موجود")).length).toBe(0);
  });

  it("استخراج الرمز من نص المسح", () => {
    const code = "W1" + "a".repeat(27);
    expect(extractTicketCode(code)).toBe(code);
    expect(extractTicketCode(`https://x.com/t/${code}`)).toBe(code);
    expect(extractTicketCode("hello")).toBeNull();
  });
});
