/**
 * نموذج البيانات في Firestore — كل مجموعة (collection) ونوع وثائقها.
 * التواريخ تُخزّن Timestamp وتُقرأ Date. المبالغ بالهللة.
 * القيود الفريدة تُضمن بمعرّفات وثائق محسوبة أو بمجموعة uniques (انظر src/lib/firestore.ts).
 */

export type User = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  passwordHash: string | null;
  /** USER | ADMIN */
  role: string;
  /** ACTIVE | SUSPENDED | INVITED */
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/** معرّف الوثيقة = بصمة رمز الجلسة */
export type Session = { id: string; userId: string; expiresAt: Date; createdAt: Date };

/** معرّف الوثيقة = بصمة الرمز */
export type AuthToken = { id: string; userId: string; purpose: string; expiresAt: Date; usedAt: Date | null; createdAt: Date };

export type Template = {
  id: string;
  name: string;
  description: string;
  category: string;
  layout: string;
  /** JSON */
  palette: string;
  /** ACTIVE | HIDDEN */
  status: string;
  /** PUBLIC | PRIVATE */
  visibility: string;
  ownerId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type Event = {
  id: string;
  ownerId: string;
  title: string;
  hostName: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  venueName: string;
  venueAddress: string;
  mapUrl: string | null;
  /** PRIVATE | PUBLIC */
  mode: string;
  capacity: number;
  /** CLOSE | WAITLIST */
  fullPolicy: string;
  templateId: string | null;
  /** DRAFT | ACTIVE | ENDED | CANCELLED */
  status: string;
  /** الأماكن المدفوعة في الباقة */
  paidPlaces: number;
  /** المقاعد المحجوزة فعليًا */
  reservedSeats: number;
  publicSlug: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Invitation = {
  id: string;
  eventId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** WHATSAPP | EMAIL | BOTH */
  channel: string;
  allowCompanion: boolean;
  token: string;
  /** NOT_SENT | QUEUED | SENT | FAILED */
  deliveryStatus: string;
  lastSentAt: Date | null;
  /** نسخة من حالة التسجيل المرتبط (null = لم يرد) — تُحدّث في نفس معاملة التسجيل */
  regStatus: string | null;
  registrationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Registration = {
  id: string;
  eventId: string;
  invitationId: string | null;
  /** INVITATION | PUBLIC */
  source: string;
  name: string;
  /** WHATSAPP | EMAIL */
  contactMethod: string;
  phone: string | null;
  email: string | null;
  dedupeKey: string | null;
  idempotencyKey: string | null;
  withCompanion: boolean;
  seats: number;
  seatsRequested: number;
  /** CONFIRMED | WAITLISTED | OFFERED | CANCELLED | DECLINED */
  status: string;
  accessToken: string;
  offeredAt: Date | null;
  offerExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  lastTicketResendAt: Date | null;
  /** يزيد مع كل تعديل — حارس التعديلات المتزامنة */
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

/** معرّف الوثيقة = `${registrationId}_${kind}` */
export type Ticket = {
  id: string;
  eventId: string;
  registrationId: string;
  /** PRIMARY | COMPANION */
  kind: string;
  holderName: string;
  /** محتوى QR — عشوائي بلا بيانات شخصية */
  code: string;
  /** ACTIVE | CANCELLED */
  status: string;
  checkedIn: boolean;
  checkedInAt: Date | null;
  checkedInById: string | null;
  checkedInByName: string | null;
  /** SCAN | MANUAL */
  checkInMethod: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** معرّف الوثيقة = `${eventId}_${userId}` */
export type EventStaff = { id: string; eventId: string; userId: string; addedById: string; createdAt: Date };

export type CheckInLog = {
  id: string;
  eventId: string;
  ticketId: string | null;
  staffId: string;
  method: string;
  result: string;
  createdAt: Date;
};

/** معرّف الوثيقة = userId */
export type Wallet = { id: string; userId: string; balance: number; createdAt: Date; updatedAt: Date };

/** معرّف الوثيقة = بصمة مفتاح منع التكرار */
export type WalletTransaction = {
  id: string;
  userId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  paymentId: string | null;
  batchId: string | null;
  messageId: string | null;
  idempotencyKey: string;
  createdAt: Date;
};

export type MessageBatch = {
  id: string;
  ownerId: string;
  eventId: string;
  kind: string;
  idempotencyKey: string;
  recipientCount: number;
  messageCount: number;
  totalCost: number;
  trigger: string;
  scheduledJobId: string | null;
  createdAt: Date;
};

export type Message = {
  id: string;
  ownerId: string;
  eventId: string | null;
  batchId: string | null;
  invitationId: string | null;
  registrationId: string | null;
  kind: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  /** QUEUED | SENDING | SENT | FAILED */
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  provider: string | null;
  providerMessageId: string | null;
  /** WALLET | PACKAGE | NONE */
  billing: string;
  cost: number;
  operatingCost: number;
  refunded: boolean;
  idempotencyKey: string;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ScheduledJob = {
  id: string;
  type: string;
  ownerId: string;
  eventId: string;
  runAt: Date;
  status: string;
  payload: string;
  result: string | null;
  estimatedCost: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export type PricingPlan = {
  id: string;
  name: string;
  places: number;
  price: number;
  active: boolean;
  sortOrder: number;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Payment = {
  id: string;
  ownerId: string;
  eventId: string | null;
  designRequestId: string | null;
  purpose: string;
  amount: number;
  currency: string;
  places: number;
  description: string;
  status: string;
  provider: string;
  providerRef: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** معرّف الوثيقة = بصمة (المزوّد + معرّف الإشعار) */
export type PaymentEvent = {
  id: string;
  provider: string;
  providerEventId: string;
  paymentId: string | null;
  type: string;
  payload: string;
  outcome: string;
  receivedAt: Date;
};

export type DesignRequest = {
  id: string;
  ownerId: string;
  eventId: string | null;
  title: string;
  details: string;
  referenceUrl: string | null;
  status: string;
  quoteAmount: number | null;
  quoteNotes: string | null;
  quoteValidUntil: Date | null;
  quotedAt: Date | null;
  acceptedAt: Date | null;
  deliveredTemplateId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SupportTicket = {
  id: string;
  ownerId: string;
  eventId: string | null;
  category: string;
  subject: string;
  body: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Comment = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  designRequestId: string | null;
  supportTicketId: string | null;
  body: string;
  createdAt: Date;
};

export type Setting = { id: string; value: string; updatedById: string | null; updatedAt: Date };

export type AuditLog = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: string;
  createdAt: Date;
};
