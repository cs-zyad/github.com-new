import { AggregateField, type Query } from "firebase-admin/firestore";
import { C, col, getDoc, getDocs, getFirst, getMany, count, byDate } from "@/lib/firestore";
import type {
  AuditLog,
  DesignRequest,
  Event,
  EventStaff,
  Invitation,
  Message,
  MessageBatch,
  Payment,
  PaymentEvent,
  PricingPlan,
  Registration,
  ScheduledJob,
  SupportTicket,
  Template,
  Ticket,
  User,
  Wallet,
  WalletTransaction,
} from "@/lib/types";
import { listComments } from "./designs";

/**
 * استعلامات القراءة للصفحات. كل استعلام بفلاتر مساواة فقط، والترتيب في الذاكرة،
 * حتى لا تحتاج قاعدة Firestore فهارس مركّبة.
 */

const indexBy = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

async function sum(q: Query, field: string): Promise<number> {
  const snap = await q.aggregate({ total: AggregateField.sum(field) }).get();
  return Number(snap.data().total ?? 0);
}

// ───────── المنظّم ─────────

export async function ownerEvents(ownerId: string) {
  const events = (await getDocs<Event>(col(C.events).where("ownerId", "==", ownerId))).sort(byDate<Event>("startsAt", "asc"));
  const invCounts = await Promise.all(events.map((e) => (e.mode === "PRIVATE" ? count(col(C.invitations).where("eventId", "==", e.id)) : 0)));
  return events.map((e, i) => ({ ...e, invitationCount: invCounts[i] }));
}

export async function ownerEventOptions(ownerId: string) {
  return (await getDocs<Event>(col(C.events).where("ownerId", "==", ownerId))).sort(byDate<Event>("startsAt", "desc"));
}

export async function staffAssignmentCount(userId: string) {
  return count(col(C.eventStaff).where("userId", "==", userId));
}

type TicketLite = Pick<Ticket, "kind" | "checkedInAt" | "checkInMethod" | "status" | "checkedInByName">;

/** المدعوون مع تسجيلاتهم وتذاكرهم (فعالية خاصة) */
export async function privateGuests(eventId: string) {
  const [invs, regs, tickets] = await Promise.all([
    getDocs<Invitation>(col(C.invitations).where("eventId", "==", eventId)),
    getDocs<Registration>(col(C.registrations).where("eventId", "==", eventId)),
    getDocs<Ticket>(col(C.tickets).where("eventId", "==", eventId)),
  ]);
  const ticketsByReg = new Map<string, TicketLite[]>();
  for (const t of tickets) ticketsByReg.set(t.registrationId, [...(ticketsByReg.get(t.registrationId) ?? []), t]);
  const regByInv = new Map(regs.filter((r) => r.invitationId).map((r) => [r.invitationId!, r]));
  return invs
    .sort(byDate<Invitation>("createdAt", "asc"))
    .map((inv) => {
      const reg = regByInv.get(inv.id);
      return { ...inv, registration: reg ? { ...reg, tickets: ticketsByReg.get(reg.id) ?? [] } : null };
    });
}

/** المسجلون من الرابط العام مع تذاكرهم */
export async function publicRegistrations(eventId: string) {
  const [regs, tickets] = await Promise.all([
    getDocs<Registration>(col(C.registrations).where("eventId", "==", eventId)),
    getDocs<Ticket>(col(C.tickets).where("eventId", "==", eventId)),
  ]);
  const ticketsByReg = new Map<string, TicketLite[]>();
  for (const t of tickets) ticketsByReg.set(t.registrationId, [...(ticketsByReg.get(t.registrationId) ?? []), t]);
  return regs.sort(byDate<Registration>("createdAt")).map((r) => ({ ...r, tickets: ticketsByReg.get(r.id) ?? [] }));
}

export async function waitlistFor(eventId: string) {
  const [w, o] = await Promise.all([
    getDocs<Registration>(col(C.registrations).where("eventId", "==", eventId).where("status", "==", "WAITLISTED")),
    getDocs<Registration>(col(C.registrations).where("eventId", "==", eventId).where("status", "==", "OFFERED")),
  ]);
  return [...w, ...o].sort(byDate<Registration>("createdAt", "asc"));
}

export async function eventMessages(eventId: string) {
  return (await getDocs<Message>(col(C.messages).where("eventId", "==", eventId)))
    .filter((m) => m.kind !== "STAFF_INVITE")
    .sort(byDate<Message>("createdAt"))
    .slice(0, 300);
}

export async function eventBatches(eventId: string) {
  const [batches, messages] = await Promise.all([
    getDocs<MessageBatch>(col(C.messageBatches).where("eventId", "==", eventId)),
    getDocs<Message>(col(C.messages).where("eventId", "==", eventId)),
  ]);
  const byBatch = new Map<string, { status: string }[]>();
  for (const m of messages) if (m.batchId) byBatch.set(m.batchId, [...(byBatch.get(m.batchId) ?? []), { status: m.status }]);
  return batches
    .sort(byDate<MessageBatch>("createdAt"))
    .slice(0, 10)
    .map((b) => ({ ...b, messages: byBatch.get(b.id) ?? [] }));
}

export async function eventJobs(eventId: string) {
  return (await getDocs<ScheduledJob>(col(C.scheduledJobs).where("eventId", "==", eventId))).sort(byDate<ScheduledJob>("runAt")).slice(0, 10);
}

export async function eventPayments(eventId: string) {
  return (await getDocs<Payment>(col(C.payments).where("eventId", "==", eventId))).sort(byDate<Payment>("createdAt"));
}

export async function invitationCounts(eventId: string) {
  const q = col(C.invitations).where("eventId", "==", eventId);
  const [total, withCompanion] = await Promise.all([count(q), count(q.where("allowCompanion", "==", true))]);
  return { total, withCompanion };
}

export async function walletPage(userId: string) {
  const [wallet, txs, payments] = await Promise.all([
    getDoc<Wallet>(C.wallets, userId),
    getDocs<WalletTransaction>(col(C.walletTransactions).where("userId", "==", userId)),
    getDocs<Payment>(col(C.payments).where("ownerId", "==", userId)),
  ]);
  return {
    balance: wallet?.balance ?? 0,
    txs: txs.sort(byDate<WalletTransaction>("createdAt")).slice(0, 50),
    payments: payments.sort(byDate<Payment>("createdAt")).slice(0, 50),
  };
}

export async function ownerDesignRequests(ownerId: string) {
  return (await getDocs<DesignRequest>(col(C.designRequests).where("ownerId", "==", ownerId))).sort(byDate<DesignRequest>("updatedAt"));
}

export async function designRequestDetail(id: string, ownerId?: string) {
  const r = await getDoc<DesignRequest>(C.designRequests, id);
  if (!r || (ownerId && r.ownerId !== ownerId)) return null;
  const [owner, event, deliveredTemplate, comments] = await Promise.all([
    getDoc<User>(C.users, r.ownerId),
    getDoc<Event>(C.events, r.eventId),
    getDoc<Template>(C.templates, r.deliveredTemplateId),
    listComments({ designRequestId: r.id }),
  ]);
  return { ...r, owner, event, deliveredTemplate, comments };
}

export async function ownerSupportTickets(ownerId: string) {
  return (await getDocs<SupportTicket>(col(C.supportTickets).where("ownerId", "==", ownerId))).sort(byDate<SupportTicket>("updatedAt"));
}

export async function supportTicketDetail(id: string, ownerId?: string) {
  const t = await getDoc<SupportTicket>(C.supportTickets, id);
  if (!t || (ownerId && t.ownerId !== ownerId)) return null;
  const [owner, event, comments] = await Promise.all([
    getDoc<User>(C.users, t.ownerId),
    getDoc<Event>(C.events, t.eventId),
    listComments({ supportTicketId: t.id }),
  ]);
  return { ...t, owner, event, comments };
}

export async function ticketByCode(code: string) {
  const t = await getFirst<Ticket>(col(C.tickets).where("code", "==", code));
  if (!t) return null;
  const [event, registration] = await Promise.all([getDoc<Event>(C.events, t.eventId), getDoc<Registration>(C.registrations, t.registrationId)]);
  if (!event || !registration) return null;
  return { ...t, event, registration };
}

export async function eventBySlug(slug: string) {
  const e = await getFirst<Event>(col(C.events).where("publicSlug", "==", slug));
  if (!e) return null;
  return { ...e, template: await getDoc<Template>(C.templates, e.templateId) };
}

export async function invitationPage(token: string) {
  const inv = await getFirst<Invitation>(col(C.invitations).where("token", "==", token));
  if (!inv) return null;
  const event = await getDoc<Event>(C.events, inv.eventId);
  if (!event) return null;
  const [template, registration] = await Promise.all([getDoc<Template>(C.templates, event.templateId), getDoc<Registration>(C.registrations, `inv_${inv.id}`)]);
  return { ...inv, event: { ...event, template }, registration };
}

export async function inboxMessages(recipientFragment: string) {
  const frag = recipientFragment.replace(/^0/, "");
  const all = await getDocs<Message>(col(C.messages).orderBy("createdAt", "desc").limit(frag ? 500 : 100));
  const list = (frag ? all.filter((m) => m.recipient.includes(frag)) : all).slice(0, 100);
  const events = indexBy(await getMany<Event>(C.events, list.map((m) => m.eventId)));
  return list.map((m) => ({ ...m, event: m.eventId ? (events.get(m.eventId) ?? null) : null }));
}

export async function exportRows(eventId: string) {
  const [regs, tickets, invs] = await Promise.all([
    getDocs<Registration>(col(C.registrations).where("eventId", "==", eventId)),
    getDocs<Ticket>(col(C.tickets).where("eventId", "==", eventId)),
    getDocs<Invitation>(col(C.invitations).where("eventId", "==", eventId)),
  ]);
  const invById = indexBy(invs);
  const ticketsByReg = new Map<string, Ticket[]>();
  for (const t of tickets) ticketsByReg.set(t.registrationId, [...(ticketsByReg.get(t.registrationId) ?? []), t]);
  return {
    registrations: regs
      .sort(byDate<Registration>("createdAt", "asc"))
      .map((r) => ({ ...r, invitation: r.invitationId ? (invById.get(r.invitationId) ?? null) : null, tickets: ticketsByReg.get(r.id) ?? [] })),
    pendingInvitations: invs.filter((i) => !i.regStatus).sort(byDate<Invitation>("createdAt", "asc")),
  };
}

// ───────── الأدمن ─────────

export async function adminOverview() {
  const [users, events, activeEvents, paid, walletSpend, packageOps, submitted, paidDesigns, inProgress, open, inProgressTickets, tickets, attended] =
    await Promise.all([
      count(col(C.users).where("role", "==", "USER")),
      count(col(C.events)),
      count(col(C.events).where("status", "==", "ACTIVE")),
      sum(col(C.payments).where("status", "==", "PAID"), "amount"),
      sum(col(C.messages).where("billing", "==", "WALLET").where("status", "==", "SENT"), "cost"),
      sum(col(C.messages).where("billing", "==", "PACKAGE").where("status", "==", "SENT"), "operatingCost"),
      count(col(C.designRequests).where("status", "==", "SUBMITTED")),
      count(col(C.designRequests).where("status", "==", "PAID")),
      count(col(C.designRequests).where("status", "==", "IN_PROGRESS")),
      count(col(C.supportTickets).where("status", "==", "OPEN")),
      count(col(C.supportTickets).where("status", "==", "IN_PROGRESS")),
      count(col(C.tickets).where("status", "==", "ACTIVE")),
      count(col(C.tickets).where("checkedIn", "==", true)),
    ]);
  return {
    users,
    events,
    activeEvents,
    paid,
    walletSpend,
    packageOps,
    pendingDesigns: submitted + paidDesigns + inProgress,
    openTickets: open + inProgressTickets,
    tickets,
    attended,
  };
}

export async function adminUsers(q: string) {
  const [users, wallets, events, staff] = await Promise.all([
    getDocs<User>(col(C.users).orderBy("createdAt", "desc").limit(500)),
    getDocs<Wallet>(col(C.wallets)),
    getDocs<Pick<Event, "id" | "ownerId">>(col(C.events).select("ownerId")),
    getDocs<Pick<EventStaff, "id" | "userId">>(col(C.eventStaff).select("userId")),
  ]);
  const term = q.trim().toLowerCase();
  const walletBy = indexBy(wallets);
  const eventsBy = new Map<string, number>();
  for (const e of events) eventsBy.set(e.ownerId, (eventsBy.get(e.ownerId) ?? 0) + 1);
  const staffBy = new Map<string, number>();
  for (const s of staff) staffBy.set(s.userId, (staffBy.get(s.userId) ?? 0) + 1);
  return users
    .filter((u) => !term || u.email.includes(term) || u.name.toLowerCase().includes(term))
    .slice(0, 200)
    .map((u) => ({
      ...u,
      wallet: walletBy.get(u.id) ?? null,
      _count: { events: eventsBy.get(u.id) ?? 0, staffAssignments: staffBy.get(u.id) ?? 0 },
    }));
}

export async function adminDesignRequests() {
  const list = await getDocs<DesignRequest>(col(C.designRequests).orderBy("updatedAt", "desc").limit(200));
  const owners = indexBy(await getMany<User>(C.users, list.map((r) => r.ownerId)));
  return list.map((r) => ({ ...r, owner: owners.get(r.ownerId) ?? { name: "", email: "" } }));
}

export async function adminSupportTickets(onlyOpen: boolean) {
  const list = await getDocs<SupportTicket>(col(C.supportTickets).orderBy("updatedAt", "desc").limit(300));
  const filtered = onlyOpen ? list.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS") : list;
  const owners = indexBy(await getMany<User>(C.users, filtered.map((t) => t.ownerId)));
  return filtered.slice(0, 200).map((t) => ({ ...t, owner: owners.get(t.ownerId) ?? { name: "" } }));
}

export async function adminTemplates() {
  const [templates, events] = await Promise.all([
    getDocs<Template>(col(C.templates)),
    getDocs<Pick<Event, "id" | "templateId">>(col(C.events).select("templateId")),
  ]);
  const usage = new Map<string, number>();
  for (const e of events) if (e.templateId) usage.set(e.templateId, (usage.get(e.templateId) ?? 0) + 1);
  const owners = indexBy(await getMany<User>(C.users, templates.map((t) => t.ownerId)));
  return templates
    .sort((a, b) => (a.visibility === b.visibility ? a.sortOrder - b.sortOrder : a.visibility === "PUBLIC" ? -1 : 1))
    .map((t) => ({ ...t, owner: t.ownerId ? (owners.get(t.ownerId) ?? null) : null, _count: { events: usage.get(t.id) ?? 0 } }));
}

export async function allPlans() {
  return (await getDocs<PricingPlan>(col(C.pricingPlans))).sort((a, b) => a.places - b.places);
}

export async function adminPayments() {
  const [payments, events] = await Promise.all([
    getDocs<Payment>(col(C.payments).orderBy("createdAt", "desc").limit(200)),
    getDocs<PaymentEvent>(col(C.paymentEvents).orderBy("receivedAt", "desc").limit(50)),
  ]);
  const owners = indexBy(await getMany<User>(C.users, payments.map((p) => p.ownerId)));
  return { payments: payments.map((p) => ({ ...p, owner: owners.get(p.ownerId) ?? { name: "" } })), events };
}

export async function adminMessages() {
  const combos = [
    ["WALLET", "WHATSAPP"],
    ["WALLET", "EMAIL"],
    ["PACKAGE", "WHATSAPP"],
    ["PACKAGE", "EMAIL"],
    ["NONE", "EMAIL"],
  ] as const;
  const sent = (b: string, ch: string) => col(C.messages).where("status", "==", "SENT").where("billing", "==", b).where("channel", "==", ch);
  const byBilling = await Promise.all(
    combos.map(async ([billing, channel]) => {
      const [n, cost, op] = await Promise.all([count(sent(billing, channel)), sum(sent(billing, channel), "cost"), sum(sent(billing, channel), "operatingCost")]);
      return { billing, channel, count: n, cost, operatingCost: op };
    }),
  );
  const statuses = ["SENT", "FAILED", "QUEUED", "SENDING"];
  const st = Object.fromEntries(
    await Promise.all(statuses.map(async (s) => [s, await count(col(C.messages).where("status", "==", s))] as const)),
  ) as Record<string, number>;
  const recent = await getDocs<Message>(col(C.messages).orderBy("createdAt", "desc").limit(100));
  const owners = indexBy(await getMany<User>(C.users, recent.map((m) => m.ownerId)));
  return {
    byBilling: byBilling.filter((b) => b.count > 0),
    st,
    recent: recent.map((m) => ({ ...m, owner: owners.get(m.ownerId) ?? { name: "" } })),
  };
}

export async function adminAudit() {
  const logs = await getDocs<AuditLog>(col(C.auditLogs).orderBy("createdAt", "desc").limit(300));
  const actors = indexBy(await getMany<User>(C.users, logs.map((l) => l.actorId)));
  return logs.map((l) => ({ ...l, actor: l.actorId ? { name: l.actorName ?? actors.get(l.actorId)?.name ?? "" } : null }));
}
