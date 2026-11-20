"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { confirmInvitation, declineInvitation, registerPublic, claimOffer, cancelByGuest, type RsvpOutcome } from "@/services/rsvp";
import { errorMessage } from "@/lib/errors";
import { str, bool, formValues } from "@/lib/actions";
import { rateLimit } from "@/lib/rateLimit";

export type GuestFormState = {
  error?: string;
  outcome?: RsvpOutcome["status"];
  values?: Record<string, string>;
  resent?: boolean;
  waitlisted?: boolean;
};

async function ipKey(prefix: string) {
  const h = await headers();
  return `${prefix}:${h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local"}`;
}

function contactFrom(fd: FormData) {
  return {
    name: str(fd, "name"),
    contactMethod: str(fd, "contactMethod") as "WHATSAPP" | "EMAIL",
    phone: str(fd, "phone"),
    email: str(fd, "email"),
  };
}

function handleOutcome(o: RsvpOutcome, fd: FormData): GuestFormState {
  if (o.status === "CONFIRMED" || o.status === "WAITLISTED") redirect(`/r/${o.accessToken}`);
  if (o.status === "OFFER_UNAVAILABLE" || o.status === "OFFER_EXPIRED") redirect(`/r/${o.accessToken}?state=${o.status}`);
  if (o.status === "ALREADY_REGISTERED") return { outcome: o.status, resent: o.resent, waitlisted: o.waitlisted, values: formValues(fd) };
  return { outcome: o.status, values: formValues(fd) };
}

export async function confirmInvitationAction(_prev: GuestFormState, fd: FormData): Promise<GuestFormState> {
  let outcome: RsvpOutcome;
  try {
    if (!rateLimit(await ipKey("rsvp"), 30, 60_000)) return { error: "محاولات كثيرة. انتظر دقيقة.", values: formValues(fd) };
    outcome = await confirmInvitation({
      token: str(fd, "token"),
      contact: contactFrom(fd),
      // الانتظار مع المرافق يعني طلب مقعدين
      withCompanion: bool(fd, "withCompanion") || bool(fd, "joinWaitlist"),
      joinWaitlist: bool(fd, "joinWaitlist"),
    });
  } catch (e) {
    return { error: errorMessage(e), values: formValues(fd) };
  }
  return handleOutcome(outcome, fd);
}

export async function declineInvitationAction(fd: FormData) {
  let token: string;
  try {
    const r = await declineInvitation(str(fd, "token"));
    token = r.accessToken;
  } catch (e) {
    redirect(`/i/${str(fd, "token")}?error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/r/${token}`);
}

export async function registerPublicAction(_prev: GuestFormState, fd: FormData): Promise<GuestFormState> {
  let outcome: RsvpOutcome;
  try {
    if (!rateLimit(await ipKey("public"), 20, 60_000)) return { error: "محاولات كثيرة. انتظر دقيقة.", values: formValues(fd) };
    outcome = await registerPublic({ slug: str(fd, "slug"), contact: contactFrom(fd), idempotencyKey: str(fd, "idem") });
  } catch (e) {
    return { error: errorMessage(e), values: formValues(fd) };
  }
  return handleOutcome(outcome, fd);
}

export async function claimOfferAction(_prev: GuestFormState, fd: FormData): Promise<GuestFormState> {
  let outcome: RsvpOutcome;
  try {
    outcome = await claimOffer(str(fd, "accessToken"), bool(fd, "withCompanion"));
  } catch (e) {
    return { error: errorMessage(e) };
  }
  if (outcome.status === "CONFIRMED") redirect(`/r/${outcome.accessToken}?state=CONFIRMED`);
  return handleOutcome(outcome, fd);
}

export async function cancelByGuestAction(fd: FormData) {
  const token = str(fd, "accessToken");
  let err = "";
  try {
    await cancelByGuest(token);
  } catch (e) {
    err = errorMessage(e);
  }
  redirect(`/r/${token}${err ? `?error=${encodeURIComponent(err)}` : "?state=CANCELLED"}`);
}
