"use server";

import { assertUser } from "@/lib/auth";
import { act, str } from "@/lib/actions";
import { parseMoney } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { startTopupCheckout, startDesignCheckout } from "@/services/payments";
import { createDesignRequest, addDesignComment, acceptDesignQuote, cancelDesignRequest } from "@/services/designs";
import { createSupportTicket, addSupportComment } from "@/services/support";

export async function topupAction(fd: FormData) {
  await act("/dashboard/wallet", async () => {
    const user = await assertUser();
    const amount = parseMoney(str(fd, "amount"));
    if (!amount) throw new AppError("أدخل مبلغًا صحيحًا");
    const r = await startTopupCheckout(user.id, amount);
    return { to: r.checkoutUrl };
  });
}

export async function createDesignRequestAction(fd: FormData) {
  await act("/dashboard/designs/new", async () => {
    const user = await assertUser();
    const r = await createDesignRequest(user.id, {
      title: str(fd, "title"),
      details: str(fd, "details"),
      referenceUrl: str(fd, "referenceUrl"),
      eventId: str(fd, "eventId"),
    });
    return { ok: "أُرسل طلبك. سيراجعه فريق المنصة ويرسل لك عرض سعر هنا.", to: `/dashboard/designs/${r.id}` };
  });
}

export async function designCommentAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/dashboard/designs/${id}`, async () => {
    const user = await assertUser();
    await addDesignComment(user.id, id, str(fd, "body"), false);
    return "أُرسلت رسالتك";
  });
}

export async function acceptQuoteAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/dashboard/designs/${id}`, async () => {
    const user = await assertUser();
    await acceptDesignQuote(user.id, id);
    const r = await startDesignCheckout(user.id, id);
    return { to: r.checkoutUrl };
  });
}

export async function payDesignAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/dashboard/designs/${id}`, async () => {
    const user = await assertUser();
    const r = await startDesignCheckout(user.id, id);
    return { to: r.checkoutUrl };
  });
}

export async function cancelDesignAction(fd: FormData) {
  const id = str(fd, "requestId");
  await act(`/dashboard/designs/${id}`, async () => {
    const user = await assertUser();
    await cancelDesignRequest(user.id, id);
    return "أُلغي الطلب";
  });
}

export async function createSupportAction(fd: FormData) {
  await act("/dashboard/support", async () => {
    const user = await assertUser();
    const t = await createSupportTicket(user.id, {
      category: str(fd, "category") as "COMPLAINT",
      subject: str(fd, "subject"),
      body: str(fd, "body"),
      eventId: str(fd, "eventId"),
    });
    return { ok: "وصل طلبك لفريق المنصة", to: `/dashboard/support/${t.id}` };
  });
}

export async function supportCommentAction(fd: FormData) {
  const id = str(fd, "ticketId");
  await act(`/dashboard/support/${id}`, async () => {
    const user = await assertUser();
    await addSupportComment(user.id, id, str(fd, "body"), false);
    return "أُرسلت رسالتك";
  });
}
