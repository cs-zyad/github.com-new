/** خطأ موجّه للمستخدم برسالة عربية واضحة */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string = "BAD_REQUEST",
    public status: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "العنصر غير موجود أو لا تملك صلاحية الوصول إليه") {
    super(message, "NOT_FOUND", 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "لا تملك صلاحية تنفيذ هذا الإجراء") {
    super(message, "FORBIDDEN", 403);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  // أخطاء إعادة التوجيه في Next يجب ألا تُبتلع
  console.error(e);
  return "حدث خطأ غير متوقع. حاول مرة أخرى.";
}
