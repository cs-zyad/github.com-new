import { brand } from "@/config/brand";
import { formatDate, formatTime } from "@/lib/format";
import { env } from "@/lib/env";

/**
 * عرض بيانات الفعالية — المصدر الوحيد لصياغة البيانات التي تظهر في
 * صفحة الدعوة، والقالب، ورسائل الإرسال، والتذكرة. أي تعديل هنا ينعكس في كل مكان.
 */
export type EventLike = {
  id: string;
  title: string;
  hostName: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  venueName: string;
  venueAddress: string;
  mapUrl: string | null;
  mode: string;
};

export type EventView = {
  title: string;
  hostName: string;
  description: string;
  dateText: string;
  timeText: string;
  endTimeText: string;
  whenText: string;
  venueName: string;
  venueAddress: string;
  venueText: string;
  mapUrl: string | null;
  brandName: string;
};

export function eventView(e: EventLike): EventView {
  const dateText = formatDate(e.startsAt, e.timezone);
  const timeText = formatTime(e.startsAt, e.timezone);
  const endTimeText = e.endsAt ? formatTime(e.endsAt, e.timezone) : "";
  const venueText = [e.venueName, e.venueAddress].filter(Boolean).join(" — ");
  return {
    title: e.title,
    hostName: e.hostName,
    description: e.description,
    dateText,
    timeText,
    endTimeText,
    whenText: `${dateText} — ${timeText}${endTimeText ? ` إلى ${endTimeText}` : ""}`,
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    venueText,
    mapUrl: e.mapUrl,
    brandName: brand.fullName,
  };
}

export const links = {
  invitation: (token: string) => `${env.appUrl}/i/${token}`,
  publicEvent: (slug: string) => `${env.appUrl}/e/${slug}`,
  registration: (accessToken: string) => `${env.appUrl}/r/${accessToken}`,
  ticket: (code: string) => `${env.appUrl}/t/${code}`,
  setPassword: (token: string) => `${env.appUrl}/set-password/${token}`,
  checkin: (eventId: string) => `${env.appUrl}/checkin/${eventId}`,
};
