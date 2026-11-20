import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
  type Transaction,
  type Query,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { createHash, randomBytes } from "node:crypto";

/**
 * الاتصال بـ Firestore (Firebase) من الخادم فقط عبر firebase-admin.
 *
 * بيانات الاعتماد (بالترتيب):
 * - FIRESTORE_EMULATOR_HOST: محاكي Firebase المحلي (للتطوير والاختبارات) مع FIREBASE_PROJECT_ID اختياري
 * - FIREBASE_SERVICE_ACCOUNT: محتوى ملف حساب الخدمة JSON كما هو، أو مرمّزًا base64
 * - FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *
 * قواعد الاستعلامات في هذا المشروع (حتى لا نحتاج فهارس مركّبة في Firestore):
 * - فلاتر مساواة فقط (where field == value)، ويمكن جمع أكثر من فلتر مساواة.
 * - الترتيب والتصفية بالمدى تتم في الذاكرة، أو orderBy على حقل واحد بدون فلاتر.
 */

const g = globalThis as unknown as { __wafdaFirestore?: Firestore };

function serviceAccount(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (raw) {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(json) as { project_id: string; client_email: string; private_key: string };
    return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
  }
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }
  return null;
}

export function firebaseConfigured(): boolean {
  return !!process.env.FIRESTORE_EMULATOR_HOST || !!serviceAccount();
}

export function db(): Firestore {
  if (g.__wafdaFirestore) return g.__wafdaFirestore;
  let app: App;
  if (getApps().length) {
    app = getApps()[0]!;
  } else if (process.env.FIRESTORE_EMULATOR_HOST) {
    app = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "demo-wafda" });
  } else {
    const sa = serviceAccount();
    if (!sa) {
      throw new Error(
        "لم تُضبط بيانات Firebase. أضف FIREBASE_SERVICE_ACCOUNT (محتوى ملف حساب الخدمة) أو شغّل محاكي Firestore.",
      );
    }
    app = initializeApp({ credential: cert(sa), projectId: sa.projectId });
  }
  const fs = getFirestore(app);
  fs.settings({ ignoreUndefinedProperties: true });
  g.__wafdaFirestore = fs;
  return fs;
}

/** أسماء المجموعات */
export const C = {
  users: "users",
  sessions: "sessions",
  authTokens: "authTokens",
  templates: "templates",
  events: "events",
  invitations: "invitations",
  registrations: "registrations",
  tickets: "tickets",
  eventStaff: "eventStaff",
  checkInLogs: "checkInLogs",
  wallets: "wallets",
  walletTransactions: "walletTransactions",
  messageBatches: "messageBatches",
  messages: "messages",
  scheduledJobs: "scheduledJobs",
  pricingPlans: "pricingPlans",
  payments: "payments",
  paymentEvents: "paymentEvents",
  designRequests: "designRequests",
  supportTickets: "supportTickets",
  comments: "comments",
  settings: "settings",
  auditLogs: "auditLogs",
  uniques: "uniques",
} as const;

export const col = (name: string) => db().collection(name);
export const ref = (name: string, id: string) => db().collection(name).doc(id);

/** معرّف عشوائي (20 حرفًا) */
export function newId(): string {
  return randomBytes(15).toString("base64url");
}

/** معرّف وثيقة ثابت من مفتاح (لمنع التكرار) */
export function keyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

/** وثيقة قيد فريد: وجودها يعني أن المفتاح مستخدم */
export function uniqueRef(key: string): DocumentReference {
  return ref(C.uniques, keyId(key));
}

function convert(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convert(v);
    return out;
  }
  return value;
}

export function fromSnap<T>(snap: DocumentSnapshot): T | null {
  if (!snap.exists) return null;
  return { ...(convert(snap.data()) as object), id: snap.id } as T;
}

export async function getDoc<T>(name: string, id: string | null | undefined): Promise<T | null> {
  if (!id) return null;
  return fromSnap<T>(await ref(name, id).get());
}

export async function getDocs<T>(q: Query): Promise<T[]> {
  const snap = await q.get();
  return snap.docs.map((d) => fromSnap<T>(d)!);
}

export async function getFirst<T>(q: Query): Promise<T | null> {
  const snap = await q.limit(1).get();
  return snap.empty ? null : fromSnap<T>(snap.docs[0]);
}

/** جلب عدة وثائق بالمعرّف (يحذف غير الموجود) */
export async function getMany<T>(name: string, ids: (string | null | undefined)[]): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return [];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += 300) {
    const snaps = await db().getAll(...unique.slice(i, i + 300).map((id) => ref(name, id)));
    for (const s of snaps) {
      const v = fromSnap<T>(s);
      if (v) out.push(v);
    }
  }
  return out;
}

export async function count(q: Query): Promise<number> {
  const snap = await q.count().get();
  return snap.data().count;
}

export async function txGet<T>(tx: Transaction, r: DocumentReference): Promise<T | null> {
  return fromSnap<T>(await tx.get(r));
}

export async function txQuery<T>(tx: Transaction, q: Query): Promise<T[]> {
  const snap = await tx.get(q);
  return snap.docs.map((d) => fromSnap<T>(d)!);
}

/**
 * معاملة Firestore: كل القراءات قبل الكتابات، وتُعاد تلقائيًا عند التعارض.
 * ما يحدث داخلها ذرّي ومعزول — أساس منع تجاوز السعة والتكرار.
 */
export function runTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db().runTransaction(fn, { maxAttempts: 20 });
}

/** حذف خصائص undefined (للدمج في update) */
export function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function byDate<T>(key: keyof T, dir: "asc" | "desc" = "desc") {
  return (a: T, b: T) => {
    const av = (a[key] as unknown as Date | null)?.getTime?.() ?? 0;
    const bv = (b[key] as unknown as Date | null)?.getTime?.() ?? 0;
    return dir === "desc" ? bv - av : av - bv;
  };
}

export type { Transaction, Query, DocumentReference };

/** بيانات الوثيقة بدون الحقل id (للكتابة) */
export function withoutId<T extends { id: string }>(o: T): Omit<T, "id"> {
  const { id: _id, ...rest } = o;
  void _id;
  return rest;
}
