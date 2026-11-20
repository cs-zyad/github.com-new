/**
 * بيانات تجريبية لاختبار الرحلة كاملة. كل شيء يُنشأ عبر خدمات المنتج نفسها
 * (الدفع بإشعار موقّع، الإرسال من الرصيد، التأكيد، التحضير) حتى تكون البيانات متسقة.
 * كلمة المرور لكل الحسابات: Wafda@2026
 */
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { randomToken } from "../src/lib/ids";
import { links } from "../src/services/presentation";
import { creditWallet } from "../src/services/wallet";
import { startPackageCheckout, handlePaymentWebhook } from "../src/services/payments";
import { buildMockWebhook } from "../src/providers/payments/mock";
import { addInvitation } from "../src/services/invitations";
import { sendInvitations } from "../src/services/sending";
import { confirmInvitation, declineInvitation, registerPublic } from "../src/services/rsvp";
import { checkIn } from "../src/services/checkin";
import { brand } from "../src/config/brand";

const PASSWORD = "Wafda@2026";
const DAY = 86400000;

function at(daysFromNow: number, hourRiyadh: number) {
  const d = new Date(Date.now() + daysFromNow * DAY);
  d.setUTCHours(hourRiyadh - 3, 0, 0, 0);
  return d;
}

async function user(email: string, name: string, role = "USER", phone?: string) {
  const u = await prisma.user.create({ data: { email, name, role, phone, passwordHash: await hashPassword(PASSWORD) } });
  await prisma.wallet.create({ data: { userId: u.id } });
  return u;
}

async function pay(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const wh = buildMockWebhook({
    providerRef: p.providerRef!,
    paymentId: p.id,
    amount: p.amount,
    currency: p.currency,
    type: "payment.succeeded",
    eventId: `evt_seed_${p.id}`,
  });
  const r = await handlePaymentWebhook(wh.rawBody, wh.headers, "mock");
  if (r.outcome !== "PROCESSED") throw new Error("seed payment failed: " + r.outcome);
}

async function topup(userId: string, amount: number) {
  await prisma.$transaction((tx) =>
    creditWallet(tx, { userId, amount, type: "ADJUSTMENT", description: "رصيد تجريبي", idempotencyKey: `seed:${userId}` }),
  );
}

async function main() {
  if (await prisma.user.findUnique({ where: { email: "admin@wafda.test" } })) {
    console.log("البيانات التجريبية موجودة مسبقًا. لإعادة الضبط: npm run db:reset");
    return;
  }

  // ───── الباقات (أسعار تجريبية) ─────
  await prisma.pricingPlan.createMany({
    data: [
      { name: "باقة 50", places: 50, price: 9900, sortOrder: 1 },
      { name: "باقة 100", places: 100, price: 17900, sortOrder: 2 },
      { name: "باقة 250", places: 250, price: 39900, sortOrder: 3 },
      { name: "باقة 500", places: 500, price: 69900, sortOrder: 4 },
      { name: "باقة 1000", places: 1000, price: 119900, sortOrder: 5 },
    ],
  });

  // ───── القوالب ─────
  const c = brand.colors;
  const pal = (o: Partial<Record<string, string>> = {}) =>
    JSON.stringify({ primary: c.plum, accent: c.lime, background: c.ivory, text: c.plum, muted: c.muted, ...o });
  const tPlum = await prisma.template.create({
    data: { name: "برقوقي فاخر", layout: "plum-frame", palette: pal(), category: "GENERAL", sortOrder: 1, description: "هوية وفدة بإطار المسح" },
  });
  await prisma.template.create({
    data: { name: "عاجي كلاسيكي", layout: "ivory-classic", palette: pal(), category: "WEDDING", sortOrder: 2, description: "للمناسبات والأفراح" },
  });
  await prisma.template.create({
    data: { name: "ليلكي ناعم", layout: "lilac-soft", palette: pal({ background: c.lilac }), category: "CLUB", sortOrder: 3, description: "للأندية والمجتمعات" },
  });
  await prisma.template.create({
    data: { name: "رسمي للشركات", layout: "corporate-clean", palette: pal({ background: "#FFFFFF" }), category: "CORPORATE", sortOrder: 4, description: "للشركات والجهات" },
  });
  const tWorkshop = await prisma.template.create({
    data: { name: "ورش وتدريب", layout: "workshop-bold", palette: pal({ background: "#FFFFFF" }), category: "WORKSHOP", sortOrder: 5, description: "للورش ومراكز التدريب" },
  });

  // ───── الحسابات ─────
  await user("admin@wafda.test", "أدمن المنصة", "ADMIN");
  const org = await user("organizer@wafda.test", "نادي التقنية", "USER", "+966500000001");
  const other = await user("other@wafda.test", "شركة أخرى", "USER");
  const staff = await user("staff@wafda.test", "سلمان — الاستقبال");
  const staff2 = await user("staff2@wafda.test", "ماجد — استقبال فعالية أخرى");
  await topup(org.id, 10000); // 100 ر.س
  await topup(other.id, 5000);

  // ───── فعالية 1: دعوات خاصة مدفوعة ─────
  const e1 = await prisma.event.create({
    data: {
      ownerId: org.id,
      title: "ملتقى نادي التقنية السنوي",
      hostName: "نادي التقنية",
      description: "أمسية تجمع أعضاء النادي وضيوفه مع جلسات حوارية وعروض مشاريع.",
      startsAt: at(10, 19),
      endsAt: at(10, 22),
      venueName: "قاعة الملتقى",
      venueAddress: "الرياض — حي الملقا",
      mapUrl: "https://maps.google.com/?q=Riyadh",
      mode: "PRIVATE",
      capacity: 30,
      fullPolicy: "WAITLIST",
      templateId: tPlum.id,
    },
  });
  const inv = async (name: string, phone: string | null, email: string | null, allowCompanion = false, channel: "WHATSAPP" | "EMAIL" | "BOTH" = "WHATSAPP") =>
    addInvitation(org.id, e1.id, { name, phone: phone ?? "", email: email ?? "", allowCompanion, channel });

  const sara = await inv("سارة العتيبي", "0501234567", null);
  const khaled = await inv("خالد الحربي", "0559876543", "khaled@example.com", true, "BOTH");
  const noura = await inv("نورة القحطاني", "0532223333", null);
  const fahad = await inv("فهد الدوسري", "0544445555", null, true);
  const reem = await inv("ريم الشهري", "0566667777", null);
  await inv("عبدالله المطيري", "0500000000", null); // ينتهي بـ 0000 → تعذّر الإرسال (محاكاة)
  await inv("منيرة السبيعي", null, "muneera@example.com", false, "EMAIL");
  await inv("بدر الغامدي", "0521112222", null, true);

  const pkg1 = await startPackageCheckout(org.id, e1.id);
  await pay(pkg1.payment.id);
  await sendInvitations(org.id, e1.id, { target: "NOT_SENT", batchKey: randomToken(8) });

  await confirmInvitation({ token: noura.token, contact: { name: "نورة القحطاني", contactMethod: "WHATSAPP", phone: "0532223333" }, withCompanion: false });
  const fahadR = await confirmInvitation({ token: fahad.token, contact: { name: "فهد الدوسري", contactMethod: "WHATSAPP", phone: "0544445555" }, withCompanion: true });
  await declineInvitation(reem.token);
  await prisma.eventStaff.create({ data: { eventId: e1.id, userId: staff.id, addedById: org.id } });
  if (fahadR.status === "CONFIRMED") {
    const t = await prisma.ticket.findFirstOrThrow({ where: { registration: { accessToken: fahadR.accessToken }, kind: "PRIMARY" } });
    await checkIn({ staffUserId: staff.id, eventId: e1.id, method: "SCAN", code: t.code });
  }
  // مدعوان أُضيفا بعد الإرسال (لم تُرسل دعوتهما بعد)
  await inv("تركي العنزي", "0587778888", null);
  await inv("هيا الزهراني", null, "haya@example.com", false, "EMAIL");

  // ───── فعالية 2: رابط عام مدفوع مع قائمة انتظار ─────
  const e2 = await prisma.event.create({
    data: {
      ownerId: org.id,
      title: "ورشة تصميم تجربة المستخدم",
      hostName: "نادي التقنية",
      description: "ورشة عملية لمدة ثلاث ساعات. أحضر جهازك المحمول.",
      startsAt: at(5, 17),
      endsAt: at(5, 20),
      venueName: "معمل الابتكار",
      venueAddress: "الرياض",
      mode: "PUBLIC",
      capacity: 20,
      fullPolicy: "WAITLIST",
      templateId: tWorkshop.id,
    },
  });
  const pkg2 = await startPackageCheckout(org.id, e2.id);
  await pay(pkg2.payment.id);
  const e2fresh = await prisma.event.findUniqueOrThrow({ where: { id: e2.id } });
  // الباقة 50 مكانًا لكن الحد الأقصى 20 كما حدده المنظّم
  await prisma.event.update({ where: { id: e2.id }, data: { capacity: 20 } });
  const pubRegs = [
    { name: "ليان العمري", contactMethod: "WHATSAPP" as const, phone: "0509990001" },
    { name: "محمد الشمري", contactMethod: "EMAIL" as const, email: "mohammed@example.com" },
    { name: "جود الحربي", contactMethod: "WHATSAPP" as const, phone: "0509990003" },
  ];
  const pubResults = [];
  for (const r of pubRegs) pubResults.push(await registerPublic({ slug: e2fresh.publicSlug!, contact: r }));
  await prisma.eventStaff.create({ data: { eventId: e2.id, userId: staff.id, addedById: org.id } });
  const firstPub = pubResults[0];
  if (firstPub.status === "CONFIRMED") {
    const t = await prisma.ticket.findFirstOrThrow({ where: { registration: { accessToken: firstPub.accessToken } } });
    await checkIn({ staffUserId: staff.id, eventId: e2.id, method: "MANUAL", ticketId: t.id });
  }

  // ───── فعالية 3: رابط عام مكتمل العدد (إغلاق التسجيل) ─────
  const e3 = await prisma.event.create({
    data: {
      ownerId: org.id,
      title: "جلسة إرشاد مهني",
      hostName: "نادي التقنية",
      startsAt: at(3, 18),
      venueName: "غرفة الاجتماعات 2",
      mode: "PUBLIC",
      capacity: 2,
      fullPolicy: "CLOSE",
      templateId: tPlum.id,
    },
  });
  const pkg3 = await startPackageCheckout(org.id, e3.id);
  await pay(pkg3.payment.id);
  await prisma.event.update({ where: { id: e3.id }, data: { capacity: 2 } });
  const e3fresh = await prisma.event.findUniqueOrThrow({ where: { id: e3.id } });
  await registerPublic({ slug: e3fresh.publicSlug!, contact: { name: "عمر السلمي", contactMethod: "WHATSAPP", phone: "0508881111" } });
  await registerPublic({ slug: e3fresh.publicSlug!, contact: { name: "أسماء الفيفي", contactMethod: "EMAIL", email: "asma@example.com" } });

  // ───── فعالية 4: مسودة ─────
  await prisma.event.create({
    data: {
      ownerId: org.id,
      title: "حفل تخرج الدفعة",
      hostName: "نادي التقنية",
      startsAt: at(30, 20),
      venueName: "المسرح الرئيسي",
      mode: "PRIVATE",
      capacity: 200,
      fullPolicy: "CLOSE",
    },
  });

  // ───── فعالية لمنظّم آخر (لاختبار العزل والصلاحيات) ─────
  const e5 = await prisma.event.create({
    data: {
      ownerId: other.id,
      title: "لقاء شركة أخرى",
      hostName: "شركة أخرى",
      startsAt: at(7, 10),
      venueName: "مكتب الشركة",
      mode: "PRIVATE",
      capacity: 10,
      fullPolicy: "CLOSE",
      templateId: tPlum.id,
    },
  });
  const otherInv = await addInvitation(other.id, e5.id, { name: "ضيف الشركة", phone: "0571231234" });
  const pkg5 = await startPackageCheckout(other.id, e5.id);
  await pay(pkg5.payment.id);
  await confirmInvitation({ token: otherInv.token, contact: { name: "ضيف الشركة", contactMethod: "WHATSAPP", phone: "0571231234" }, withCompanion: false });
  await prisma.eventStaff.create({ data: { eventId: e5.id, userId: staff2.id, addedById: other.id } });

  // ───── طلبات التصميم والدعم ─────
  await prisma.designRequest.create({
    data: {
      ownerId: org.id,
      eventId: e1.id,
      title: "دعوة بهوية النادي",
      details: "نحتاج قالب دعوة بألوان النادي وشعاره، بخط عربي واضح، ومساحة لصورة القاعة.",
      status: "SUBMITTED",
    },
  });
  await prisma.designRequest.create({
    data: {
      ownerId: org.id,
      title: "قالب حفل التخرج",
      details: "تصميم رسمي لحفل التخرج مع أسماء الرعاة.",
      status: "QUOTED",
      quoteAmount: 45000,
      quoteNotes: "يشمل التصميم وتعديلين ويُسلّم خلال 5 أيام عمل.",
      quotedAt: new Date(),
      quoteValidUntil: new Date(Date.now() + 14 * DAY),
    },
  });
  await prisma.supportTicket.create({
    data: {
      ownerId: org.id,
      eventId: e1.id,
      category: "COMPLAINT",
      subject: "رسالة لم تصل لأحد المدعوين",
      body: "المدعو عبدالله المطيري يقول إن الدعوة لم تصله على واتساب.",
    },
  });

  const e2s = await prisma.event.findUniqueOrThrow({ where: { id: e2.id } });
  console.log(`
✓ تم تجهيز البيانات التجريبية — كلمة المرور لكل الحسابات: ${PASSWORD}

الحسابات:
  منظّم:                organizer@wafda.test
  فريق استقبال:         staff@wafda.test      (معيّن على الملتقى والورشة)
  أدمن المنصة:          admin@wafda.test
  منظّم آخر:            other@wafda.test      (لاختبار عزل البيانات)
  استقبال فعالية أخرى:  staff2@wafda.test     (لاختبار تقييد الصلاحيات)

روابط للتجربة:
  دعوة خاصة فردية (سارة):        ${links.invitation(sara.token)}
  دعوة تسمح بمرافق (خالد):       ${links.invitation(khaled.token)}
  رابط عام مع قائمة انتظار:      ${links.publicEvent(e2s.publicSlug!)}
  رابط عام مكتمل العدد:          ${links.publicEvent(e3fresh.publicSlug!)}
  التحضير (الملتقى):             ${links.checkin(e1.id)}
  صندوق الرسائل التجريبي:        ${links.invitation("").replace(/\/i\/$/, "")}/dev/inbox
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
