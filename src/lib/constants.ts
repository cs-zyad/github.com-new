/** القيم المسموحة للحالات والأنواع (المخطط يخزّنها كنصوص) */

export const EVENT_MODES = ["PRIVATE", "PUBLIC"] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const FULL_POLICIES = ["CLOSE", "WAITLIST"] as const;
export type FullPolicy = (typeof FULL_POLICIES)[number];

export const EVENT_STATUSES = ["DRAFT", "ACTIVE", "ENDED", "CANCELLED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const CHANNELS = ["WHATSAPP", "EMAIL"] as const;
export type Channel = (typeof CHANNELS)[number];

export const INVITE_CHANNELS = ["WHATSAPP", "EMAIL", "BOTH"] as const;
export type InviteChannel = (typeof INVITE_CHANNELS)[number];

export const DELIVERY_STATUSES = ["NOT_SENT", "QUEUED", "SENT", "FAILED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const REG_STATUSES = ["CONFIRMED", "WAITLISTED", "OFFERED", "CANCELLED", "DECLINED"] as const;
export type RegStatus = (typeof REG_STATUSES)[number];

export const MESSAGE_KINDS = [
  "INVITATION",
  "REMINDER",
  "CONFIRMATION",
  "WAITLIST_OFFER",
  "STAFF_INVITE",
  "TICKET_RESEND",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const PAYMENT_PURPOSES = ["PACKAGE", "EXTRA_PLACES", "WALLET_TOPUP", "DESIGN"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const DESIGN_STATUSES = [
  "SUBMITTED",
  "QUOTED",
  "ACCEPTED",
  "PAID",
  "IN_PROGRESS",
  "DELIVERED",
  "REJECTED",
  "CANCELLED",
] as const;
export type DesignStatus = (typeof DESIGN_STATUSES)[number];

export const SUPPORT_CATEGORIES = ["COMPLAINT", "QUESTION", "BILLING", "TECHNICAL"] as const;
export const SUPPORT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

export const TEMPLATE_LAYOUTS = [
  "plum-frame",
  "ivory-classic",
  "lilac-soft",
  "corporate-clean",
  "workshop-bold",
] as const;
export type TemplateLayout = (typeof TEMPLATE_LAYOUTS)[number];

export const TEMPLATE_CATEGORIES = ["GENERAL", "WEDDING", "CORPORATE", "ACADEMIC", "WORKSHOP", "CLUB"] as const;
