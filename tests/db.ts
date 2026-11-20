/**
 * طبقة قراءة صغيرة للاختبارات فقط تحاكي استدعاءات التحقق المستخدمة في ملفات الاختبار
 * فوق Firestore (فلاتر مساواة بسيطة). تبقي شروط الاختبارات كما هي بعد الانتقال لـ Firestore.
 */
import { C, col, ref, getDoc, getDocs, newId, type Query } from "@/lib/firestore";

type Where = Record<string, unknown>;
type Args = { select?: unknown; where?: Where; data?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; include?: Record<string, unknown>; _sum?: Record<string, boolean> };

const map = {
  event: C.events,
  invitation: C.invitations,
  registration: C.registrations,
  ticket: C.tickets,
  message: C.messages,
  messageBatch: C.messageBatches,
  walletTransaction: C.walletTransactions,
  payment: C.payments,
  scheduledJob: C.scheduledJobs,
  eventStaff: C.eventStaff,
  wallet: C.wallets,
} as const;

function model(name: keyof typeof map) {
  const collection = map[name];
  async function find(args: Args = {}) {
    const where = args.where ?? {};
    let rows: Record<string, unknown>[];
    if (typeof where.id === "string" && Object.keys(where).length === 1) {
      const d = await getDoc<Record<string, unknown>>(collection, where.id);
      rows = d ? [d] : [];
    } else {
      let q: Query = col(collection);
      for (const [k, v] of Object.entries(where)) q = q.where(k, "==", v);
      rows = await getDocs<Record<string, unknown>>(q);
    }
    if (args.orderBy) {
      const [k, dir] = Object.entries(args.orderBy)[0];
      rows = rows.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
    }
    if (args.include?.registration && name === "invitation") {
      rows = await Promise.all(rows.map(async (r) => ({ ...r, registration: await getDoc(C.registrations, `inv_${r.id}`) })));
    }
    return rows;
  }
  const one = async (args: Args) => {
    const [r] = await find(args);
    if (!r) throw new Error(`${name} not found: ${JSON.stringify(args.where)}`);
    return r as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return {
    findMany: async (args?: Args) => (await find(args)) as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
    findUniqueOrThrow: one,
    findFirstOrThrow: one,
    count: async (args?: Args) => (await find(args)).length,
    aggregate: async (args: Args) => {
      const rows = await find(args);
      const k = Object.keys(args._sum ?? {})[0];
      return { _sum: { [k]: rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) } } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    update: async (args: Args) => {
      await ref(collection, String(args.where!.id)).update(args.data!);
      return getDoc(collection, String(args.where!.id));
    },
    create: async (args: Args) => {
      const d = args.data!;
      const id = name === "eventStaff" ? `${d.eventId}_${d.userId}` : newId();
      await ref(collection, id).set({ createdAt: new Date(), ...d });
      return { id, ...d };
    },
  };
}

export const store = {
  event: model("event"),
  invitation: model("invitation"),
  registration: model("registration"),
  ticket: model("ticket"),
  message: model("message"),
  messageBatch: model("messageBatch"),
  walletTransaction: model("walletTransaction"),
  payment: model("payment"),
  scheduledJob: model("scheduledJob"),
  eventStaff: model("eventStaff"),
};
