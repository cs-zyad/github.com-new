import type { Db } from "./db";

/** تسجيل العمليات الإدارية والمهمة */
export async function audit(
  db: Db,
  params: { actorId?: string | null; action: string; entityType: string; entityId?: string | null; meta?: unknown },
) {
  await db.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      meta: JSON.stringify(params.meta ?? {}),
    },
  });
}
