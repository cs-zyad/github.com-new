"use server";

import { assertAdmin } from "@/lib/auth";
import { act, bool, str } from "@/lib/actions";
import { C, ref, newId, getDoc } from "@/lib/firestore";
import { AppError } from "@/lib/errors";
import { parseMoney } from "@/lib/format";
import { audit } from "@/lib/audit";
import { updateSettings, type OperatingSettings } from "@/lib/settings";
import { setUserStatus } from "@/services/accounts";
import {
  quoteDesignRequest,
  rejectDesignRequest,
  setDesignInProgress,
  deliverDesign,
  addDesignComment,
  createTemplate,
  updateTemplate,
  type Palette,
} from "@/services/designs";
import { addSupportComment, setSupportStatus } from "@/services/support";
import { creditWallet } from "@/services/wallet";
import { randomToken } from "@/lib/ids";

function palette(fd: FormData): Palette {
  return {
    primary: str(fd, "primary"),
    accent: str(fd, "accent"),
    background: str(fd, "background"),
    text: str(fd, "text"),
    muted: str(fd, "muted"),
  };
}

export async function setUserStatusAction(fd: FormData) {
  await act("/admin/users", async () => {
    const admin = await assertAdmin();
    const status = str(fd, "status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    await setUserStatus(admin.id, str(fd, "userId"), status);
    return status === "SUSPENDED" ? "أُوقف الحساب وأُنهيت جلساته" : "فُعّل الحساب";
  });
}

export async function adjustWalletAction(fd: FormData) {
  await act("/admin/users", async () => {
    const admin = await assertAdmin();
    const amount = parseMoney(str(fd, "amount"));
    const sign = str(fd, "direction") === "debit" ? -1 : 1;
    const reason = str(fd, "reason").trim();
    if (!amount) throw new AppError("أدخل مبلغًا صحيحًا");
    if (reason.length < 3) throw new AppError("اكتب سبب التسوية");
    const userId = str(fd, "userId");
    {
      await creditWallet({
        userId,
        amount: sign * amount,
        type: "ADJUSTMENT",
        description: `تسوية من الأدمن: ${reason}`,
        idempotencyKey: `adj:${randomToken(10)}`,
      });
      await audit({ actorId: admin.id, action: "wallet.adjust", entityType: "User", entityId: userId, meta: { amount: sign * amount, reason } });
    }
    return "سُجّلت التسوية";
  });
}

export async function quoteDesignAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/admin/designs/${id}`, async () => {
    const admin = await assertAdmin();
    await quoteDesignRequest(admin.id, id, { amount: str(fd, "amount"), notes: str(fd, "notes"), validDays: str(fd, "validDays") });
    return "أُرسل عرض السعر للمنظّم";
  });
}

export async function rejectDesignAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/admin/designs/${id}`, async () => {
    const admin = await assertAdmin();
    await rejectDesignRequest(admin.id, id, str(fd, "reason"));
    return "رُفض الطلب";
  });
}

export async function progressDesignAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/admin/designs/${id}`, async () => {
    const admin = await assertAdmin();
    await setDesignInProgress(admin.id, id);
    return "الطلب قيد التنفيذ";
  });
}

export async function deliverDesignAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/admin/designs/${id}`, async () => {
    const admin = await assertAdmin();
    await deliverDesign(admin.id, id, { name: str(fd, "name"), layout: str(fd, "layout"), palette: palette(fd) });
    return "سُلّم التصميم كقالب خاص بالمنظّم";
  });
}

export async function adminDesignCommentAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/admin/designs/${id}`, async () => {
    const admin = await assertAdmin();
    await addDesignComment(admin.id, id, str(fd, "body"), true);
    return "أُرسلت الرسالة";
  });
}

export async function adminSupportCommentAction(fd: FormData) {
  const id = str(fd, "ticketId");
  await act(`/admin/support/${id}`, async () => {
    const admin = await assertAdmin();
    await addSupportComment(admin.id, id, str(fd, "body"), true);
    return "أُرسل الرد";
  });
}

export async function supportStatusAction(fd: FormData) {
  const id = str(fd, "ticketId");
  await act(`/admin/support/${id}`, async () => {
    const admin = await assertAdmin();
    await setSupportStatus(admin.id, id, str(fd, "status"));
    return "حُدّثت الحالة";
  });
}

export async function createTemplateAction(fd: FormData) {
  await act("/admin/templates", async () => {
    const admin = await assertAdmin();
    await createTemplate(admin.id, {
      name: str(fd, "name"),
      layout: str(fd, "layout"),
      palette: palette(fd),
      category: str(fd, "category") || "GENERAL",
      description: str(fd, "description"),
      visibility: "PUBLIC",
      sortOrder: Number(str(fd, "sortOrder")) || 100,
    });
    return "أُضيف القالب";
  });
}

export async function updateTemplateAction(fd: FormData) {
  await act("/admin/templates", async () => {
    const admin = await assertAdmin();
    await updateTemplate(admin.id, str(fd, "templateId"), {
      name: str(fd, "name"),
      layout: str(fd, "layout"),
      palette: palette(fd),
      category: str(fd, "category"),
      description: str(fd, "description"),
      status: str(fd, "status"),
      sortOrder: Number(str(fd, "sortOrder")) || 100,
    });
    return "حُفظ القالب";
  });
}

// ───────── الباقات والإعدادات ─────────

export async function savePlanAction(fd: FormData) {
  await act("/admin/settings", async () => {
    const admin = await assertAdmin();
    const id = str(fd, "planId");
    const name = str(fd, "name").trim();
    const places = Number(str(fd, "places"));
    const price = parseMoney(str(fd, "price"));
    if (!name) throw new AppError("اكتب اسم الباقة");
    if (!Number.isInteger(places) || places < 1) throw new AppError("عدد الأماكن غير صالح");
    if (price === null) throw new AppError("السعر غير صالح");
    const data = { name, places, price, active: bool(fd, "active"), isDemo: bool(fd, "isDemo"), sortOrder: places };
    const planId = id || newId();
    if (id && !(await getDoc(C.pricingPlans, id))) throw new AppError("الباقة غير موجودة");
    await ref(C.pricingPlans, planId).set({ ...data, updatedAt: new Date(), ...(id ? {} : { createdAt: new Date() }) }, { merge: true });
    await audit({ actorId: admin.id, action: id ? "plan.update" : "plan.create", entityType: "PricingPlan", entityId: planId, meta: data });
    return "حُفظت الباقة";
  });
}

export async function saveSettingsAction(fd: FormData) {
  await act("/admin/settings", async () => {
    const admin = await assertAdmin();
    const m = (k: string) => {
      const v = parseMoney(str(fd, k));
      if (v === null) throw new AppError("قيمة مالية غير صالحة");
      return v;
    };
    const int = (k: string, min: number, max: number) => {
      const v = Number(str(fd, k));
      if (!Number.isInteger(v) || v < min || v > max) throw new AppError("قيمة رقمية غير صالحة");
      return v;
    };
    const patch: Partial<OperatingSettings> = {
      messagePrice: { WHATSAPP: m("priceWhatsapp"), EMAIL: m("priceEmail") },
      extraPlacePrice: m("extraPlacePrice"),
      confirmationOperatingCost: { WHATSAPP: m("opWhatsapp"), EMAIL: m("opEmail") },
      insufficientBalancePolicy: str(fd, "insufficientBalancePolicy") === "SEND_AFFORDABLE" ? "SEND_AFFORDABLE" : "BLOCK",
      maxSendAttempts: int("maxSendAttempts", 1, 10),
      retryBaseSeconds: int("retryBaseSeconds", 5, 3600),
      refundOnFailure: bool(fd, "refundOnFailure"),
      waitlistOfferHours: int("waitlistOfferHours", 1, 336),
      ticketResendCooldownMinutes: int("ticketResendCooldownMinutes", 0, 1440),
    };
    await updateSettings(patch, admin.id);
    return "حُفظت إعدادات التشغيل وسُجّل التغيير في سجل التدقيق";
  });
}
