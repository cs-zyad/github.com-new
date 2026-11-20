import { eventView, links, type EventLike } from "./presentation";
import { brand } from "@/config/brand";

/**
 * صياغة نصوص الرسائل. كل البيانات تأتي من eventView حتى تتطابق مع صفحة الدعوة والقالب.
 */
type Composed = { subject: string; body: string };

function footer() {
  return `\n\n— ${brand.fullName}`;
}

export function composeInvitation(
  event: EventLike,
  inv: { name: string; token: string; allowCompanion: boolean },
  kind: "INVITATION" | "REMINDER",
): Composed {
  const v = eventView(event);
  const host = v.hostName ? `يسعد ${v.hostName} دعوتك` : "يسعدنا دعوتك";
  const companion = inv.allowCompanion ? "\nالدعوة تسمح باصطحاب مرافق واحد." : "";
  if (kind === "REMINDER") {
    return {
      subject: `تذكير: ${v.title}`,
      body:
        `مرحبًا ${inv.name}،\n` +
        `نذكّرك بدعوتك لحضور «${v.title}» ولم يصلنا تأكيدك بعد.\n` +
        `📅 ${v.whenText}\n📍 ${v.venueText}${companion}\n\n` +
        `أكّد حضورك من الرابط:\n${links.invitation(inv.token)}` +
        footer(),
    };
  }
  return {
    subject: `دعوة: ${v.title}`,
    body:
      `مرحبًا ${inv.name}،\n` +
      `${host} لحضور «${v.title}».\n` +
      `📅 ${v.whenText}\n📍 ${v.venueText}${companion}\n\n` +
      `أكّد حضورك من الرابط:\n${links.invitation(inv.token)}` +
      footer(),
  };
}

export function composeConfirmation(
  event: EventLike,
  reg: { name: string; accessToken: string },
  tickets: { kind: string; code: string }[],
): Composed {
  const v = eventView(event);
  const primary = tickets.find((t) => t.kind === "PRIMARY");
  const companion = tickets.find((t) => t.kind === "COMPANION");
  let body =
    `مرحبًا ${reg.name}،\n` +
    `تم تأكيد حضورك في «${v.title}».\n` +
    `📅 ${v.whenText}\n📍 ${v.venueText}\n\n`;
  if (primary) body += `تذكرتك (اعرضها عند الدخول):\n${links.ticket(primary.code)}\n`;
  if (companion) {
    body += `\nتذكرة مرافقك — شاركها معه، وكل تذكرة تدخل بشكل مستقل:\n${links.ticket(companion.code)}\n`;
  }
  body += `\nلإدارة حضورك أو الاعتذار:\n${links.registration(reg.accessToken)}`;
  return { subject: `تذكرتك: ${v.title}`, body: body + footer() };
}

export function composeTicketResend(
  event: EventLike,
  reg: { name: string; accessToken: string },
  tickets: { kind: string; code: string }[],
): Composed {
  const c = composeConfirmation(event, reg, tickets);
  return { subject: `إعادة إرسال تذكرتك: ${event.title}`, body: c.body.replace("تم تأكيد حضورك", "تسجيلك مؤكد") };
}

export function composeWaitlistOffer(
  event: EventLike,
  reg: { name: string; accessToken: string; offerExpiresAt: Date | null },
  hours: number,
): Composed {
  const v = eventView(event);
  return {
    subject: `توفّر مقعد: ${v.title}`,
    body:
      `مرحبًا ${reg.name}،\n` +
      `توفّر مقعد في «${v.title}» وأنت في قائمة الانتظار.\n` +
      `📅 ${v.whenText}\n📍 ${v.venueText}\n\n` +
      `أكّد حضورك خلال ${hours} ساعة من الرابط (يُحجز المقعد عند التأكيد إذا كان لا يزال متاحًا):\n` +
      `${links.registration(reg.accessToken)}` +
      footer(),
  };
}

export function composeStaffInvite(
  event: EventLike,
  staff: { name: string },
  setPasswordToken: string | null,
): Composed {
  const v = eventView(event);
  const access = setPasswordToken
    ? `أنشئ كلمة المرور من الرابط:\n${links.setPassword(setPasswordToken)}\n\nثم افتح صفحة التحضير:\n${links.checkin(event.id)}`
    : `افتح صفحة التحضير بعد تسجيل الدخول:\n${links.checkin(event.id)}`;
  return {
    subject: `فريق الاستقبال: ${v.title}`,
    body: `مرحبًا ${staff.name}،\nأُضفت إلى فريق الاستقبال في «${v.title}» (${v.whenText}).\n\n${access}${footer()}`,
  };
}
