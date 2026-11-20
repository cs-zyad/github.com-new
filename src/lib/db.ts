import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; walEnabled?: boolean };

/**
 * اتصال عبر مجمّع اتصالات (مثل Neon pooler على Vercel) يحتاج pgbouncer=true مع Prisma
 * لتعطيل العبارات المُعدّة التي لا يدعمها وضع المعاملات.
 */
function resolveUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres/.test(url)) return undefined;
  if (/-pooler\./.test(url) && !/pgbouncer=/.test(url)) {
    return url + (url.includes("?") ? "&" : "?") + "pgbouncer=true";
  }
  return undefined;
}

const datasourceUrl = resolveUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "error", "warn"] : ["error"],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

export const isSqlite = (process.env.DATABASE_URL ?? "").startsWith("file:");

/** تفعيل WAL في SQLite لتحسين القراءة المتزامنة (مرة واحدة لكل عملية) */
export async function ensureDbReady() {
  if (!isSqlite || globalForPrisma.walEnabled) return;
  globalForPrisma.walEnabled = true;
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  } catch {
    // غير حرج
  }
}

/**
 * تنفيذ معاملة مع إعادة المحاولة عند تعارض الكتابة أو انشغال قاعدة البيانات.
 * منطق الحجز نفسه آمن (تحديث شرطي ذرّي + قيود فريدة)، وإعادة المحاولة تحسّن التجربة تحت الضغط فقط.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await prisma.$transaction(fn, { maxWait: 15000, timeout: 20000 });
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) throw e;
      await new Promise((r) => setTimeout(r, 20 * (i + 1) + Math.random() * 30));
    }
  }
  throw lastErr;
}

function isRetryable(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return e.code === "P2034" || e.code === "P1008";
  }
  const msg = e instanceof Error ? e.message : String(e);
  return /database is locked|SQLITE_BUSY|could not serialize|deadlock detected/i.test(msg);
}

export function isUniqueViolation(e: unknown, field?: string) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    if (!field) return true;
    const target = (e.meta?.target ?? []) as string[] | string;
    return Array.isArray(target) ? target.some((t) => t.includes(field)) : String(target).includes(field);
  }
  return false;
}
