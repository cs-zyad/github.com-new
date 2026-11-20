import { C, ref, getDoc, keyId, runTx, txGet, type Transaction } from "@/lib/firestore";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import type { Wallet, WalletTransaction } from "@/lib/types";

/** رصيد الرسائل: وثيقة رصيد لكل منظّم + دفتر قيود بمعرّفات ثابتة من مفتاح منع التكرار */

export async function ensureWallet(userId: string): Promise<Wallet> {
  const w = await getDoc<Wallet>(C.wallets, userId);
  if (w) return w;
  const now = new Date();
  await ref(C.wallets, userId).set({ userId, balance: 0, createdAt: now, updatedAt: now }, { merge: true });
  return (await getDoc<Wallet>(C.wallets, userId))!;
}

export async function getBalance(userId: string): Promise<number> {
  return (await getDoc<Wallet>(C.wallets, userId))?.balance ?? 0;
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

/** مرحلة القراءة: الرصيد وقيد مفتاح التكرار */
export async function readWalletState(tx: Transaction, userId: string, idempotencyKey: string) {
  const [wallet, entry] = await Promise.all([
    txGet<Wallet>(tx, ref(C.wallets, userId)),
    txGet<WalletTransaction>(tx, ref(C.walletTransactions, keyId(idempotencyKey))),
  ]);
  return { balance: wallet?.balance ?? 0, exists: !!wallet, entryExists: !!entry };
}

/** مرحلة الكتابة: قيد + تحديث الرصيد (المبلغ موجب للإضافة وسالب للخصم) */
export function writeWalletEntry(
  tx: Transaction,
  state: { balance: number; exists: boolean },
  params: {
    userId: string;
    amount: number;
    type: "TOPUP" | "DEBIT" | "REFUND" | "ADJUSTMENT";
    description: string;
    idempotencyKey: string;
    paymentId?: string;
    batchId?: string;
    messageId?: string;
  },
) {
  const now = new Date();
  const balanceAfter = state.balance + params.amount;
  tx.set(
    ref(C.wallets, params.userId),
    state.exists ? { balance: balanceAfter, updatedAt: now } : { userId: params.userId, balance: balanceAfter, createdAt: now, updatedAt: now },
    { merge: true },
  );
  tx.set(ref(C.walletTransactions, keyId(params.idempotencyKey)), {
    userId: params.userId,
    type: params.type,
    amount: params.amount,
    balanceAfter,
    description: params.description,
    paymentId: params.paymentId ?? null,
    batchId: params.batchId ?? null,
    messageId: params.messageId ?? null,
    idempotencyKey: params.idempotencyKey,
    createdAt: now,
  });
  return balanceAfter;
}

/** إضافة رصيد (شحن/استرجاع/تسوية) بمعاملة مستقلة — مرة واحدة لكل مفتاح */
export async function creditWallet(params: {
  userId: string;
  amount: number;
  type: "TOPUP" | "REFUND" | "ADJUSTMENT";
  description: string;
  idempotencyKey: string;
  paymentId?: string;
  messageId?: string;
}): Promise<{ applied: boolean }> {
  return runTx(async (tx) => {
    const st = await readWalletState(tx, params.userId, params.idempotencyKey);
    if (st.entryExists) return { applied: false };
    if (st.balance + params.amount < 0) throw new AppError("الرصيد لا يكفي للخصم");
    writeWalletEntry(tx, st, params);
    return { applied: true };
  });
}
