import { C, col, newId, type Transaction } from "./firestore";

type AuditParams = {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
};

function data(p: AuditParams) {
  return {
    actorId: p.actorId ?? null,
    actorName: p.actorName ?? null,
    action: p.action,
    entityType: p.entityType,
    entityId: p.entityId ?? null,
    meta: JSON.stringify(p.meta ?? {}),
    createdAt: new Date(),
  };
}

/** تسجيل العمليات الإدارية والمهمة */
export async function audit(p: AuditParams) {
  await col(C.auditLogs).doc(newId()).set(data(p));
}

/** داخل معاملة (كتابة — تُستدعى بعد كل القراءات) */
export function auditTx(tx: Transaction, p: AuditParams) {
  tx.set(col(C.auditLogs).doc(newId()), data(p));
}
