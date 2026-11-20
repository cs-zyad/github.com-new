import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { sendInvitations, sendReminderNow, scheduleReminder, runDueJobs, previewInvitationSend } from "@/services/sending";
import { processOutbox } from "@/services/messaging";
import { confirmInvitation } from "@/services/rsvp";
import { getBalance } from "@/services/wallet";
import { updateSettings } from "@/lib/settings";
import { makeEvent, makeInvitation, makeUser, resetDb, topUp } from "./helpers";

beforeEach(resetDb);

// الأسعار الافتراضية: واتساب 25 هللة، بريد 5 هللات

describe("الإرسال والرصيد", () => {
  it("إرسال الدعوات يخصم حسب القناة وعدد الرسائل، والضغط المتكرر لا يكرر الخصم", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id);
    await makeInvitation(event.id, { channel: "WHATSAPP" });
    await makeInvitation(event.id, { phone: null, email: "a@x.com", channel: "EMAIL" });
    await makeInvitation(event.id, { email: "b@x.com", channel: "BOTH" });
    const preview = await previewInvitationSend(owner.id, event.id, "NOT_SENT");
    expect(preview.count).toBe(4);
    expect(preview.total).toBe(25 + 5 + 25 + 5);

    const [r1, r2] = await Promise.all([
      sendInvitations(owner.id, event.id, { target: "NOT_SENT", batchKey: "same-click" }),
      sendInvitations(owner.id, event.id, { target: "NOT_SENT", batchKey: "same-click" }),
    ]);
    expect(r1.batchId).toBe(r2.batchId);
    expect([r1.duplicate, r2.duplicate].filter(Boolean).length).toBe(1);
    expect(r1.totalCost).toBe(60);
    expect(await getBalance(owner.id)).toBe(1000 - 60);
    expect(await prisma.message.count({ where: { kind: "INVITATION" } })).toBe(4);
    const statuses = await prisma.invitation.findMany({ select: { deliveryStatus: true } });
    expect(statuses.every((s) => s.deliveryStatus === "SENT")).toBe(true);
  });

  it("الرصيد غير الكافي (BLOCK): لا يُرسل شيء ولا يُخصم شيء", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 30);
    const event = await makeEvent(owner.id);
    await makeInvitation(event.id);
    await makeInvitation(event.id);
    await expect(sendInvitations(owner.id, event.id, { target: "NOT_SENT", batchKey: "k1" })).rejects.toThrow(/الرصيد غير كافٍ/);
    expect(await getBalance(owner.id)).toBe(30);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.messageBatch.count()).toBe(0);
  });

  it("الرصيد غير الكافي (SEND_AFFORDABLE): يُرسل ما يغطيه الرصيد فقط", async () => {
    const owner = await makeUser();
    await updateSettings({ insufficientBalancePolicy: "SEND_AFFORDABLE" }, owner.id);
    await topUp(owner.id, 60);
    const event = await makeEvent(owner.id);
    for (let i = 0; i < 4; i++) await makeInvitation(event.id);
    const r = await sendInvitations(owner.id, event.id, { target: "NOT_SENT", batchKey: "k2" });
    expect(r.queued).toBe(2);
    expect(r.skipped).toBe(2);
    expect(await getBalance(owner.id)).toBe(10);
    expect(await prisma.invitation.count({ where: { deliveryStatus: "NOT_SENT" } })).toBe(2);
  });

  it("تعذّر الإرسال حالة مستقلة ويُسترجع مبلغ الرسالة", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id);
    const bad = await makeInvitation(event.id, { phone: "+966500000000" }); // ينتهي بـ 0000 → فشل محاكاة
    const good = await makeInvitation(event.id);
    await sendInvitations(owner.id, event.id, { target: "NOT_SENT", batchKey: "k3" });
    const b = await prisma.invitation.findUniqueOrThrow({ where: { id: bad.id }, include: { registration: true } });
    const g = await prisma.invitation.findUniqueOrThrow({ where: { id: good.id } });
    expect(b.deliveryStatus).toBe("FAILED");
    expect(b.registration).toBeNull(); // "لم يؤكد" منفصلة عن "تعذّر الإرسال"
    expect(g.deliveryStatus).toBe("SENT");
    expect(await getBalance(owner.id)).toBe(1000 - 25); // خُصم 50 واسترجع 25
    expect(await prisma.walletTransaction.count({ where: { type: "REFUND" } })).toBe(1);
  });

  it("الفشل المؤقت يُعاد بأمان ثم ينجح دون خصم إضافي", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id);
    const inv = await makeInvitation(event.id, { phone: "+966500001111" }); // فشل مؤقت أول مرة
    await sendInvitations(owner.id, event.id, { target: "NOT_SENT", batchKey: "k4" });
    let msg = await prisma.message.findFirstOrThrow({ where: { invitationId: inv.id } });
    expect(msg.status).toBe("QUEUED");
    expect(msg.attempts).toBe(1);
    await prisma.message.update({ where: { id: msg.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await processOutbox();
    msg = await prisma.message.findFirstOrThrow({ where: { invitationId: inv.id } });
    expect(msg.status).toBe("SENT");
    expect(msg.attempts).toBe(2);
    expect(await getBalance(owner.id)).toBe(975);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).deliveryStatus).toBe("SENT");
  });

  it("لا إرسال إذا تجاوزت الدعوات أماكن الباقة المدفوعة", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id, { paidPlaces: 2 });
    await makeInvitation(event.id, { allowCompanion: true });
    await makeInvitation(event.id);
    await expect(sendInvitations(owner.id, event.id, { target: "NOT_SENT", batchKey: "k5" })).rejects.toThrow(/مكانًا إضافيًا/);
  });

  it("رسالة تأكيد الحضور ضمن الباقة ولا تُخصم من الرصيد", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id);
    const inv = await makeInvitation(event.id, { allowCompanion: true });
    await confirmInvitation({ token: inv.token, contact: { name: "ضيف", contactMethod: "EMAIL", email: "g@x.com" }, withCompanion: true });
    const msg = await prisma.message.findFirstOrThrow({ where: { kind: "CONFIRMATION" } });
    expect(msg.billing).toBe("PACKAGE");
    expect(msg.cost).toBe(0);
    expect(msg.operatingCost).toBeGreaterThan(0);
    expect(msg.channel).toBe("EMAIL");
    expect(msg.recipient).toBe("g@x.com");
    expect(msg.body).toContain("/t/W1"); // رابط التذكرة
    expect(msg.body.match(/\/t\/W1/g)?.length).toBe(2); // رمز المدعو + رمز المرافق لنفس المستلم
    expect(await getBalance(owner.id)).toBe(1000);
  });

  it("التذكير يصل فقط لمن وصلته الدعوة ولم يرد", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id);
    const a = await makeInvitation(event.id, { deliveryStatus: "SENT" });
    const b = await makeInvitation(event.id, { deliveryStatus: "SENT" });
    await makeInvitation(event.id, { deliveryStatus: "FAILED" });
    await makeInvitation(event.id, { deliveryStatus: "NOT_SENT" });
    await confirmInvitation({ token: b.token, contact: { name: "بدر", contactMethod: "WHATSAPP", phone: "0507777777" }, withCompanion: false });
    const r = await sendReminderNow(owner.id, event.id, "rk1");
    expect(r.recipients).toBe(1);
    const reminders = await prisma.message.findMany({ where: { kind: "REMINDER" } });
    expect(reminders.length).toBe(1);
    expect(reminders[0].invitationId).toBe(a.id);
  });

  it("التذكير المجدول يفحص الحالة لحظة التنفيذ ولا يُنفّذ مرتين", async () => {
    const owner = await makeUser();
    await topUp(owner.id, 1000);
    const event = await makeEvent(owner.id);
    const a = await makeInvitation(event.id, { deliveryStatus: "SENT" });
    const b = await makeInvitation(event.id, { deliveryStatus: "SENT" });
    const { job } = await scheduleReminder(owner.id, event.id, new Date(Date.now() + 3600_000));
    expect(job.estimatedCost).toBe(50);
    // قبل التنفيذ: أحدهما أكّد
    await confirmInvitation({ token: a.token, contact: { name: "أحمد", contactMethod: "WHATSAPP", phone: "0508888888" }, withCompanion: false });
    await prisma.scheduledJob.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } });
    const [d1, d2] = await Promise.all([runDueJobs(), runDueJobs()]);
    expect(d1 + d2).toBe(1);
    const reminders = await prisma.message.findMany({ where: { kind: "REMINDER" } });
    expect(reminders.map((m) => m.invitationId)).toEqual([b.id]);
    expect(await getBalance(owner.id)).toBe(1000 - 25);
    const done = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("DONE");
  });

  it("التذكير المجدول برصيد غير كافٍ يفشل بوضوح دون إرسال جزئي", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner.id);
    await makeInvitation(event.id, { deliveryStatus: "SENT" });
    const { job } = await scheduleReminder(owner.id, event.id, new Date(Date.now() + 3600_000));
    await prisma.scheduledJob.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await runDueJobs();
    const j = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe("FAILED");
    expect(JSON.parse(j.result!).reason).toBe("INSUFFICIENT_BALANCE");
    expect(await prisma.message.count()).toBe(0);
  });
});
