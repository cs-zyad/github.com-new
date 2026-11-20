import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { store } from "./db";
import { classifyImportRows, commitImport, addInvitation, updateInvitation, deleteInvitation } from "@/services/invitations";
import { parseInviteeFile, buildTemplateWorkbook } from "@/services/importFile";
import { getOwnedEvent, updateEvent } from "@/services/events";
import { cancelByOrganizer, confirmInvitation } from "@/services/rsvp";
import { sendInvitations } from "@/services/sending";
import { addStaff } from "@/services/staff";
import { normalizePhone, normalizeEmail } from "@/lib/contact";
import { NotFoundError } from "@/lib/errors";
import { makeEvent, makeInvitation, makeUser, resetDb, topUp } from "./helpers";

beforeEach(resetDb);

describe("أرقام الجوال والبريد", () => {
  it("توحيد صيغ الأرقام السعودية والدولية", () => {
    expect(normalizePhone("0501234567")).toBe("+966501234567");
    expect(normalizePhone("501234567")).toBe("+966501234567");
    expect(normalizePhone("966501234567")).toBe("+966501234567");
    expect(normalizePhone("00966 50 123 4567")).toBe("+966501234567");
    expect(normalizePhone("٠٥٠١٢٣٤٥٦٧")).toBe("+966501234567");
    expect(normalizePhone("+971501234567")).toBe("+971501234567");
    expect(normalizePhone("05012")).toBeNull();
    expect(normalizePhone("+96650")).toBeNull();
    expect(normalizeEmail(" Sara@Example.COM ")).toBe("sara@example.com");
    expect(normalizeEmail("sara@")).toBeNull();
  });
});

describe("استيراد المدعوين", () => {
  it("المعاينة تصنّف المقبول والمكرر والذي يحتاج تصحيحًا", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id);
    await makeInvitation(event.id, { phone: "+966500000099" });
    const preview = await classifyImportRows(event.id, [
      { row: 2, name: "سارة", phone: "0501234567", email: "", companion: "لا" },
      { row: 3, name: "خالد", phone: "0559876543", email: "k@x.com", companion: "نعم" },
      { row: 4, name: "مكرر بالملف", phone: "0501234567", email: "", companion: "" },
      { row: 5, name: "موجود مسبقًا", phone: "0500000099", email: "", companion: "" },
      { row: 6, name: "", phone: "0501111111", email: "", companion: "" },
      { row: 7, name: "بدون تواصل", phone: "", email: "", companion: "" },
      { row: 8, name: "رقم خطأ", phone: "123", email: "", companion: "" },
    ]);
    expect(preview.accepted).toBe(2);
    expect(preview.duplicates).toBe(2);
    expect(preview.invalid).toBe(3);
    expect(preview.rows.find((r) => r.row === 3)?.normalized?.allowCompanion).toBe(true);
    expect(preview.rows.find((r) => r.row === 4)?.reason).toContain("الصف 2");
  });

  it("الاعتماد يعيد التحقق في الخادم ويضيف المقبول فقط", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id);
    const r = await commitImport(
      owner.id,
      event.id,
      [
        { row: 2, name: "سارة", phone: "0501234567", email: "s@x.com", companion: "" },
        { row: 3, name: "سارة مكررة", phone: "0501234567", email: "", companion: "" },
        { row: 4, name: "خطأ", phone: "1", email: "", companion: "" },
      ],
      "BOTH",
    );
    expect(r.added).toBe(1);
    const inv = await store.invitation.findFirstOrThrow({ where: { eventId: event.id } });
    expect(inv.channel).toBe("BOTH");
    expect(inv.phone).toBe("+966501234567");
  });

  it("قراءة ملف Excel وملف CSV", async () => {
    const buf = await buildTemplateWorkbook();
    const rows = await parseInviteeFile("guests.xlsx", buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("سارة العتيبي");
    expect(rows[1].companion).toBe("نعم");

    // أرقام مخزنة كأرقام في Excel (بدون الصفر)
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("x");
    ws.addRow(["Name", "Mobile", "Email"]);
    ws.addRow(["Ali", 501234567, { text: "ali@x.com", hyperlink: "mailto:ali@x.com" }]);
    const b2 = Buffer.from(await wb.xlsx.writeBuffer());
    const rows2 = await parseInviteeFile("x.xlsx", b2.buffer.slice(b2.byteOffset, b2.byteOffset + b2.byteLength) as ArrayBuffer);
    expect(rows2[0].phone).toBe("501234567");
    expect(rows2[0].email).toBe("ali@x.com");
    expect(normalizePhone(rows2[0].phone)).toBe("+966501234567");

    const csv = new TextEncoder().encode('﻿الاسم,الجوال,البريد,مرافق\n"العتيبي, سارة",0501234567,,نعم\n');
    const rows3 = await parseInviteeFile("a.csv", csv.buffer as ArrayBuffer);
    expect(rows3[0].name).toBe("العتيبي, سارة");
    expect(rows3[0].companion).toBe("نعم");
    await expect(parseInviteeFile("a.xls", csv.buffer as ArrayBuffer)).rejects.toThrow(/xlsx/);
  });
});

describe("عزل بيانات المنظّمين", () => {
  it("منظّم لا يصل لفعاليات أو مدعوي أو تسجيلات منظّم آخر", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await topUp(b.id, 10000);
    const eventA = await makeEvent(a.id);
    const invA = await makeInvitation(eventA.id);
    const c = await confirmInvitation({
      token: invA.token,
      contact: { name: "ضيف", contactMethod: "WHATSAPP", phone: "0509999999" },
      withCompanion: false,
    });
    if (c.status !== "CONFIRMED") throw new Error();
    const regA = await store.registration.findUniqueOrThrow({ where: { accessToken: c.accessToken } });

    await expect(getOwnedEvent(eventA.id, b.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateEvent(b.id, eventA.id, {
        title: "اختراق",
        startsAt: "2099-01-01T10:00",
        venueName: "x",
        mode: "PRIVATE",
        capacity: 5,
        fullPolicy: "CLOSE",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(addInvitation(b.id, eventA.id, { name: "x", phone: "0501231231" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateInvitation(b.id, invA.id, { name: "x", phone: "0501231231" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteInvitation(b.id, invA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelByOrganizer(b.id, regA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendInvitations(b.id, eventA.id, { target: "NOT_SENT", batchKey: "zz" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addStaff(b.id, eventA.id, { name: "x", email: "x@x.com" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await store.registration.findUniqueOrThrow({ where: { id: regA.id } })).status).toBe("CONFIRMED");
  });
});
