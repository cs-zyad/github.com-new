"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertUser } from "@/lib/auth";
import { act, bool, str, formValues, type FormState } from "@/lib/actions";
import { errorMessage, AppError } from "@/lib/errors";
import { localInputToDate } from "@/lib/format";
import { createEvent, updateEvent, setEventTemplate, cancelEvent, deleteDraftEvent } from "@/services/events";
import { addInvitation, updateInvitation, deleteInvitation, setChannelForAll, commitImport, classifyImportRows, type ImportRow } from "@/services/invitations";
import { parseInviteeFile } from "@/services/importFile";
import { sendInvitations, sendReminderNow, scheduleReminder, cancelScheduledReminder, offerWaitlistSpot } from "@/services/sending";
import { addStaff, removeStaff } from "@/services/staff";
import { cancelByOrganizer, resendTicket } from "@/services/rsvp";
import { startPackageCheckout, startExtraPlacesCheckout } from "@/services/payments";
import { getOwnedEvent } from "@/services/events";
import type { InviteChannel } from "@/lib/constants";

function eventInput(fd: FormData) {
  return {
    title: str(fd, "title"),
    hostName: str(fd, "hostName"),
    description: str(fd, "description"),
    startsAt: str(fd, "startsAt"),
    endsAt: str(fd, "endsAt"),
    venueName: str(fd, "venueName"),
    venueAddress: str(fd, "venueAddress"),
    mapUrl: str(fd, "mapUrl"),
    mode: str(fd, "mode") as "PRIVATE" | "PUBLIC",
    capacity: str(fd, "capacity"),
    fullPolicy: str(fd, "fullPolicy") as "CLOSE" | "WAITLIST",
  };
}

export async function createEventAction(_prev: FormState, fd: FormData): Promise<FormState> {
  let id: string;
  try {
    const user = await assertUser();
    const e = await createEvent(user.id, eventInput(fd));
    id = e.id;
  } catch (e) {
    return { error: errorMessage(e), values: formValues(fd) };
  }
  redirect(`/dashboard/events/${id}/template?ok=${encodeURIComponent("أُنشئت المسودة. اختر قالب الدعوة.")}`);
}

export async function updateEventAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "eventId");
  try {
    const user = await assertUser();
    await updateEvent(user.id, id, eventInput(fd));
  } catch (e) {
    return { error: errorMessage(e), values: formValues(fd) };
  }
  revalidatePath(`/dashboard/events/${id}`);
  redirect(`/dashboard/events/${id}?ok=${encodeURIComponent("حُفظت بيانات الفعالية")}`);
}

export async function chooseTemplateAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/template`, async () => {
    const user = await assertUser();
    await setEventTemplate(user.id, id, str(fd, "templateId"));
    return "تم اختيار القالب. راجع المعاينة أدناه.";
  });
}

export async function cancelEventAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}`, async () => {
    const user = await assertUser();
    await cancelEvent(user.id, id);
    return "أُلغيت الفعالية وأُوقفت التذكيرات المجدولة";
  });
}

export async function deleteDraftAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}`, async () => {
    const user = await assertUser();
    await deleteDraftEvent(user.id, id);
    return { ok: "حُذفت المسودة", to: "/dashboard" };
  });
}

// ───────── المدعوون ─────────

function inviteInput(fd: FormData) {
  return {
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    channel: (str(fd, "channel") || "WHATSAPP") as InviteChannel,
    allowCompanion: bool(fd, "allowCompanion"),
  };
}

export async function addInvitationAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/guests`, async () => {
    const user = await assertUser();
    const inv = await addInvitation(user.id, id, inviteInput(fd));
    return `أُضيف ${inv.name}`;
  });
}

export async function updateInvitationAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/guests`, async () => {
    const user = await assertUser();
    await updateInvitation(user.id, str(fd, "invitationId"), inviteInput(fd));
    return "حُفظت بيانات المدعو";
  });
}

export async function deleteInvitationAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/guests`, async () => {
    const user = await assertUser();
    await deleteInvitation(user.id, str(fd, "invitationId"));
    return "حُذف المدعو";
  });
}

export async function setChannelAllAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/guests`, async () => {
    const user = await assertUser();
    const r = await setChannelForAll(user.id, id, str(fd, "channel") as InviteChannel);
    return r.adjusted
      ? `طُبّقت القناة على ${r.total} مدعو، وعُدّلت لـ ${r.adjusted} حسب بيانات التواصل المتاحة`
      : `طُبّقت القناة على ${r.total} مدعو`;
  });
}

export async function cancelRegistrationAction(fd: FormData) {
  const id = str(fd, "eventId");
  const back = str(fd, "back") || `/dashboard/events/${id}/guests`;
  await act(back, async () => {
    const user = await assertUser();
    await cancelByOrganizer(user.id, str(fd, "registrationId"));
    return "أُلغي التسجيل وتحرّرت المقاعد";
  });
}

export async function resendTicketAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/guests`, async () => {
    const user = await assertUser();
    await getOwnedEvent(id, user.id);
    const { C, getDoc } = await import("@/lib/firestore");
    const reg = await getDoc<{ id: string; eventId: string }>(C.registrations, str(fd, "registrationId"));
    if (!reg || reg.eventId !== id) throw new AppError("التسجيل غير موجود");
    const ok = await resendTicket(reg.id);
    const { kickOutbox } = await import("@/services/messaging");
    await kickOutbox();
    return ok ? "أُعيد إرسال التذكرة لوسيلة تواصل الضيف" : "أُرسلت التذكرة مؤخرًا. انتظر قليلًا قبل إعادة الإرسال.";
  });
}

// ───────── الاستيراد ─────────

export type ImportPreviewState = {
  error?: string;
  preview?: Awaited<ReturnType<typeof classifyImportRows>>;
  fileName?: string;
};

export async function previewImportAction(_prev: ImportPreviewState, fd: FormData): Promise<ImportPreviewState> {
  try {
    const user = await assertUser();
    const eventId = str(fd, "eventId");
    const event = await getOwnedEvent(eventId, user.id);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "اختر ملف Excel أو CSV" };
    const rows = await parseInviteeFile(file.name, await file.arrayBuffer());
    const preview = await classifyImportRows(event.id, rows);
    return { preview, fileName: file.name };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function recheckImportAction(eventId: string, rows: ImportRow[]) {
  const user = await assertUser();
  const event = await getOwnedEvent(eventId, user.id);
  return classifyImportRows(event.id, rows);
}

export async function commitImportAction(eventId: string, rows: ImportRow[], channel: InviteChannel) {
  try {
    const user = await assertUser();
    const r = await commitImport(user.id, eventId, rows, channel);
    revalidatePath(`/dashboard/events/${eventId}/guests`);
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ───────── الإرسال والتذكيرات ─────────

export async function sendInvitationsAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/send`, async () => {
    const user = await assertUser();
    const target = str(fd, "target") as "NOT_SENT" | "FAILED" | "SELECTED";
    const ids = fd.getAll("invitationIds").filter((x): x is string => typeof x === "string");
    const r = await sendInvitations(user.id, id, { target, invitationIds: ids, batchKey: str(fd, "batchKey") });
    if (r.duplicate) return "هذا الطلب نُفّذ مسبقًا — لم يتكرر الإرسال أو الخصم";
    return `أُرسلت ${r.queued} رسالة${r.skipped ? ` (لم تُرسل ${r.skipped} لعدم كفاية الرصيد)` : ""}. راجع سجل الإرسال أدناه.`;
  });
}

export async function sendReminderNowAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/send`, async () => {
    const user = await assertUser();
    const r = await sendReminderNow(user.id, id, str(fd, "batchKey"));
    if (r.duplicate) return "هذا التذكير نُفّذ مسبقًا";
    return `أُرسل التذكير إلى ${r.recipients} مدعو (${r.queued} رسالة)`;
  });
}

export async function scheduleReminderAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/send`, async () => {
    const user = await assertUser();
    const runAt = localInputToDate(str(fd, "runAt"));
    if (!runAt) throw new AppError("حدّد موعد التذكير");
    await scheduleReminder(user.id, id, runAt);
    return "جُدول التذكير. عند التنفيذ يصل فقط لمن لا يزال بحاجة للتأكيد.";
  });
}

export async function cancelReminderAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/send`, async () => {
    const user = await assertUser();
    await cancelScheduledReminder(user.id, str(fd, "jobId"));
    return "أُلغي التذكير المجدول";
  });
}

export async function offerWaitlistAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/waitlist`, async () => {
    const user = await assertUser();
    const r = await offerWaitlistSpot(user.id, str(fd, "registrationId"), str(fd, "batchKey"));
    return r.duplicate ? "أُرسلت الفرصة مسبقًا" : "أُرسلت فرصة التأكيد. يُحجز المقعد عندما يؤكد الشخص.";
  });
}

// ───────── فريق الاستقبال ─────────

export async function addStaffAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/staff`, async () => {
    const user = await assertUser();
    const r = await addStaff(user.id, id, { name: str(fd, "name"), email: str(fd, "email") });
    return r.setPasswordToken
      ? "أُضيف العضو وأُرسل له رابط إنشاء كلمة المرور على بريده"
      : "أُضيف العضو. يستطيع الدخول بحسابه الحالي وفتح صفحة التحضير.";
  });
}

export async function removeStaffAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/staff`, async () => {
    const user = await assertUser();
    await removeStaff(user.id, id, str(fd, "userId"));
    return "أُزيلت صلاحية العضو لهذه الفعالية";
  });
}

// ───────── الباقة والدفع ─────────

export async function packageCheckoutAction(fd: FormData) {
  const id = str(fd, "eventId");
  let url = "";
  await act(`/dashboard/events/${id}/billing`, async () => {
    const user = await assertUser();
    const r = await startPackageCheckout(user.id, id);
    url = r.checkoutUrl;
    return { to: url };
  });
}

export async function extraPlacesCheckoutAction(fd: FormData) {
  const id = str(fd, "eventId");
  await act(`/dashboard/events/${id}/billing`, async () => {
    const user = await assertUser();
    const r = await startExtraPlacesCheckout(user.id, id, Number(str(fd, "places")));
    return { to: r.checkoutUrl };
  });
}
