import { prisma, type Db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";

/** رصيد الرسائل: دفتر قيود (WalletTransaction) + رصيد مخزّن يُحدّث بعمليات ذرّية مشروطة */

export async function ensureWallet(userId: string, db: Db = prisma) {
  return db.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function getBalance(userId: string, db: Db = prisma): Promise<number> {
  const w = await db.wallet.findUnique({ where: { userId } });
  return w?.balance ?? 0;
}

export class InsufficientBalanceError extends AppError {
  constructor(
    public required: number,
    public balance: number,
  ) {
    super(
      `الرصيد غير كافٍ. التكلفة ${formatMoney(required)} والرصيد الحالي ${formatMoney(balance)}. اشحن ${formatMoney(
        required - balance,
      )} على الأقل.`,
      "INSUFFICIENT_BALANCE",
      402,
    );
  }
}

/**
 * خصم ذرّي: ينجح فقط إذا كان الرصيد يكفي (UPDATE ... WHERE balance >= amount).
 * القيد محمي بمفتاح فريد فلا يتكرر الخصم عند إعادة المحاولة.
 */
export async function debitWallet(
  tx: Tx,
  params: { userId: string; amount: number; description: string; idempotencyKey: string; batchId?: string },
) {
  if (params.amount <= 0) return null;
  const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return existing;
  const wallet = await ensureWallet(params.userId, tx);
  const res = await tx.wallet.updateMany({
    where: { id: wallet.id, balance: { gte: params.amount } },
    data: { balance: { decrement: params.amount } },
  });
  if (res.count === 0) {
    const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    throw new InsufficientBalanceError(params.amount, fresh.balance);
  }
  const after = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  return tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "DEBIT",
      amount: -params.amount,
      balanceAfter: after.balance,
      description: params.description,
      batchId: params.batchId,
      idempotencyKey: params.idempotencyKey,
    },
  });
}

/** إضافة رصيد (شحن أو استرجاع) — محمية بمفتاح فريد */
export async function creditWallet(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    type: "TOPUP" | "REFUND" | "ADJUSTMENT";
    description: string;
    idempotencyKey: string;
    paymentId?: string;
    messageId?: string;
  },
) {
  const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return { tx: existing, applied: false };
  const wallet = await ensureWallet(params.userId, tx);
  // القيد أولًا: إذا تكرر المفتاح بالتزامن يفشل الإدراج وتُلغى المعاملة كاملة
  const entry = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: params.type,
      amount: params.amount,
      balanceAfter: 0,
      description: params.description,
      paymentId: params.paymentId,
      messageId: params.messageId,
      idempotencyKey: params.idempotencyKey,
    },
  });
  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: { increment: params.amount } },
  });
  const final = await tx.walletTransaction.update({ where: { id: entry.id }, data: { balanceAfter: updated.balance } });
  return { tx: final, applied: true };
}
