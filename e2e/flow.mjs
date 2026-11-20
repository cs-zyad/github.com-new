// سيناريو الرحلة الكاملة: من لوحة المنظّم إلى وصول الضيف عند باب الفعالية.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const QRCode = require("qrcode");

const BASE = process.env.BASE_URL;
const SHOTS = process.env.SHOTS_DIR || path.resolve("e2e/screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "Wafda@2026";

const errors = [];
let step = 0;
function log(msg) {
  step++;
  console.log(`  ✓ ${step}. ${msg}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
}

function watch(page, label) {
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) {
      errors.push(`[${label}] console: ${m.text()}`);
    }
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}

/** ينقر ثم ينتظر رسالة النجاح/الخطأ الجديدة بالنص المتوقع */
async function clickAndFlash(page, locator, text) {
  await locator.click();
  await page.waitForSelector(`.alert:has-text("${text}")`, { timeout: 15000 });
}

async function expectNoAppError(page, url) {
  const res = await page.goto(url);
  assert(res && res.status() < 400, `${url} → HTTP ${res?.status()}`);
  const body = await page.textContent("body");
  assert(!body.includes("حدث خطأ غير متوقع"), `${url} shows unexpected error`);
}

async function inboxLink(page, recipientFragment, kindText, pathPrefix) {
  await page.goto(`${BASE}/dev/inbox?to=${encodeURIComponent(recipientFragment)}`);
  const cards = page.locator("article", { hasText: kindText });
  const count = await cards.count();
  assert(count > 0, `no inbox message "${kindText}" for ${recipientFragment}`);
  const hrefs = await cards.first().locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  return hrefs.filter((h) => h && h.startsWith(pathPrefix));
}

const browser = await chromium.launch();
try {
  // ───────── المنظّم (كمبيوتر) ─────────
  const orgCtx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, locale: "ar-SA" });
  const org = await orgCtx.newPage();
  watch(org, "organizer");
  await login(org, "organizer@wafda.test");
  assert(org.url().includes("/dashboard"), "organizer lands on dashboard");
  await shot(org, "01-dashboard-desktop");
  log("دخول المنظّم ولوحة الفعاليات");

  // إنشاء فعالية خاصة
  await org.goto(`${BASE}/dashboard/events/new`);
  await org.fill("#title", "عشاء تكريم المتطوعين");
  await org.fill("#hostName", "فريق التطوع");
  await org.fill("#venueName", "مطعم الواحة");
  await org.fill("#capacity", "10");
  await Promise.all([org.waitForURL(/\/template/), org.click("button[type=submit]")]);
  const eventId = org.url().match(/events\/([^/]+)\/template/)[1];
  log("إنشاء مسودة فعالية خاصة");

  // اختيار القالب
  await clickAndFlash(org, org.locator("form", { has: org.locator('input[name="templateId"]') }).nth(1).locator("button"), "تم اختيار القالب");
  assert(await org.locator("#preview").isVisible(), "preview visible after choosing template");
  await shot(org, "02-template-preview-desktop");
  log("اختيار القالب ومعاينة الدعوة والرسالة");

  // إضافة المدعوين
  await org.goto(`${BASE}/dashboard/events/${eventId}/guests`);
  const addForm = org.locator("form", { has: org.locator("#new-name") });
  await addForm.locator("#new-name").fill("ضيف فردي");
  await addForm.locator("#new-phone").fill("0511111111");
  await clickAndFlash(org, addForm.locator("button[type=submit]"), "أُضيف ضيف فردي");
  const addForm2 = org.locator("form", { has: org.locator("#new-name") });
  if (!(await addForm2.locator("#new-name").isVisible())) await org.locator("details.box summary").first().click();
  await addForm2.locator("#new-name").fill("ضيف بمرافق");
  await addForm2.locator("#new-phone").fill("0522222222");
  await addForm2.locator("#new-email").fill("companion.guest@example.com");
  await addForm2.locator("#new-channel").selectOption("BOTH");
  await addForm2.locator('input[name="allowCompanion"]').check();
  await clickAndFlash(org, addForm2.locator("button[type=submit]"), "أُضيف ضيف بمرافق");
  assert((await org.locator(".list-item").count()) === 2, "two invitations listed");
  log("إضافة مدعو فردي ومدعو يسمح بمرافق");

  // الدفع (التجريبي) — 3 أماكن مطلوبة
  await org.goto(`${BASE}/dashboard/events/${eventId}/billing`);
  assert((await org.textContent("body")).includes("الإجمالي"), "package summary shown");
  await shot(org, "03-billing-desktop");
  await Promise.all([org.waitForURL(/\/dev\/checkout\//), org.locator("form button[type=submit]").first().click()]);
  await Promise.all([org.waitForURL(/billing\?ok=/), org.locator("form button[type=submit]").first().click()]);
  assert((await org.textContent("body")).includes("تم الدفع"), "payment confirmed");
  log("دفع الباقة عبر الإشعار الموقّع وتفعيل الفعالية");

  // إرسال الدعوات
  await org.goto(`${BASE}/dashboard/events/${eventId}/send`);
  org.once("dialog", (d) => d.accept());
  await Promise.all([org.waitForURL(/send\?ok=/), org.locator("form", { has: org.locator('input[name="target"][value="NOT_SENT"]') }).locator("button").click()]);
  assert((await org.textContent("body")).includes("أُرسلت 3 رسالة"), "3 messages sent (1 WA + 1 WA + 1 email)");
  await shot(org, "04-send-desktop");
  log("إرسال الدعوات وخصم الرصيد حسب القناة");

  // ───────── الضيف (جوال) ─────────
  const guestCtx = await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" });
  const guest = await guestCtx.newPage();
  watch(guest, "guest");

  const [inviteLink1] = await inboxLink(guest, "511111111", "دعوة", "/i/");
  assert(inviteLink1, "invitation link found in inbox");
  await guest.goto(`${BASE}${inviteLink1}`);
  await shot(guest, "05-invitation-mobile");
  assert(!(await guest.locator('input[name="withCompanion"]').count()), "individual invitation has no companion option");
  await Promise.all([guest.waitForURL(/\/r\//), guest.click("button[type=submit]:has-text('أكّد حضورك')")]);
  assert((await guest.textContent("body")).includes("تم تأكيد حضورك"), "individual confirmed");
  assert((await guest.locator(".ticket").count()) === 1, "one ticket for individual");
  await shot(guest, "06-ticket-mobile");
  log("الضيف الفردي يفتح الدعوة من الجوال ويؤكد ويستلم تذكرة واحدة");

  // تكرار التأكيد من نفس الرابط
  await guest.goto(`${BASE}${inviteLink1}`);
  assert((await guest.textContent("body")).includes("أكّدت حضورك"), "re-opening invitation shows already confirmed");
  log("إعادة فتح الدعوة لا تكرر الحجز");

  const [inviteLink2] = await inboxLink(guest, "522222222", "دعوة", "/i/");
  await guest.goto(`${BASE}${inviteLink2}`);
  await guest.locator('input[name="withCompanion"]').check();
  await Promise.all([guest.waitForURL(/\/r\//), guest.click("button[type=submit]:has-text('أكّد حضورك')")]);
  assert((await guest.locator(".ticket").count()) === 2, "two tickets for invitee with companion");
  await shot(guest, "07-tickets-companion-mobile");
  log("المدعو مع مرافق يستلم تذكرتين مستقلتين");

  const confirmLinks = await inboxLink(guest, "522222222", "تأكيد الحضور", "/t/");
  assert(confirmLinks.length === 2, "confirmation message has both ticket links for the invitee");
  const primaryCode = confirmLinks[0].split("/t/")[1];
  const companionCode = confirmLinks[1].split("/t/")[1];
  assert(primaryCode !== companionCode, "distinct codes");
  await guest.goto(`${BASE}${confirmLinks[1]}`);
  assert((await guest.textContent("body")).includes("تذكرة مرافق"), "companion ticket page works standalone");
  log("رسالة التأكيد تحمل رمزي المدعو والمرافق لنفس المستلم، وصفحة تذكرة المرافق مستقلة");

  // ───────── فريق الاستقبال ─────────
  await org.goto(`${BASE}/dashboard/events/${eventId}/staff`);
  await org.fill("#sname", "سلمان");
  await org.fill("#semail", "staff@wafda.test");
  await clickAndFlash(org, org.locator("form", { has: org.locator("#semail") }).locator("button"), "أُضيف العضو");
  log("المنظّم يمنح عضو الاستقبال صلاحية هذه الفعالية");

  // كاميرا وهمية تعرض رمز QR الفعلي لتذكرة المدعو
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wafda-cam-"));
  const png = path.join(tmp, "qr.png");
  const y4m = path.join(tmp, "qr.y4m");
  await QRCode.toFile(png, primaryCode, { width: 520, margin: 4 });
  execSync(`ffmpeg -loglevel error -y -loop 1 -i ${png} -t 2 -vf "scale=640:640,format=yuv420p" -r 10 ${y4m}`);
  const camBrowser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
  });
  const staffCtx = await camBrowser.newContext({ ...devices["Pixel 7"], locale: "ar-SA", permissions: ["camera"] });
  const staffPage = await staffCtx.newPage();
  watch(staffPage, "staff");
  await login(staffPage, "staff@wafda.test");
  await staffPage.goto(`${BASE}/checkin/${eventId}`);
  await staffPage.click("button:has-text('ابدأ المسح بالكاميرا')");
  await staffPage.waitForSelector(".scan-result", { timeout: 15000 });
  const scanText = await staffPage.textContent(".scan-result");
  assert(scanText.includes("تم تسجيل الدخول") && scanText.includes("ضيف بمرافق"), "camera scan checks in invitee: " + scanText);
  await shot(staffPage, "08-scan-success-mobile");
  log("مسح QR بالكاميرا من الجوال يسجّل دخول المدعو");

  // الكاميرا ما زالت تعرض نفس الرمز → بعد مهلة منع التكرار يظهر حضر مسبقًا
  await staffPage.waitForFunction(() => document.querySelector(".scan-result")?.textContent?.includes("حضر مسبقًا"), null, { timeout: 15000 });
  await shot(staffPage, "09-scan-already-mobile");
  await staffPage.click("button:has-text('إيقاف الكاميرا')");
  log("المسح المكرر لنفس الرمز يظهر «حضر مسبقًا» مع الوقت");

  // البحث اليدوي وتسجيل المرافق
  await staffPage.fill('input[aria-label="بحث عن ضيف"]', "ضيف بمرافق");
  await staffPage.waitForSelector("button:has-text('تسجيل الحضور يدويًا')", { timeout: 10000 });
  const results = await staffPage.locator(".card .list .list-item").count();
  assert(results === 2, "search returns invitee + companion tickets: " + results);
  await staffPage.click("button:has-text('تسجيل الحضور يدويًا')");
  await staffPage.waitForFunction(() => document.querySelector(".scan-result")?.textContent?.includes("تم تسجيل الدخول"), null, { timeout: 10000 });
  assert((await staffPage.textContent(".scan-result")).includes("تذكرة مرافق"), "companion manual check-in success");
  await shot(staffPage, "10-manual-companion-mobile");
  log("البحث بالاسم وتسجيل المرافق يدويًا في وقت مستقل");

  // إدخال رمز المرافق بعد التسجيل اليدوي → حضر مسبقًا
  await staffPage.click("summary:has-text('إدخال رمز التذكرة يدويًا')");
  await staffPage.fill('input[aria-label="رمز التذكرة"]', `${BASE}/t/${companionCode}`);
  await staffPage.click("button:has-text('تحقق')");
  await staffPage.waitForFunction(() => document.querySelector(".scan-result")?.textContent?.includes("حضر مسبقًا"), null, { timeout: 10000 });
  log("المسح بعد التسجيل اليدوي لا يكرر الحضور");
  await camBrowser.close();

  // عضو استقبال غير معيّن
  const s2Ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "ar-SA" });
  const s2 = await s2Ctx.newPage();
  watch(s2, "staff2");
  await login(s2, "staff2@wafda.test");
  await s2.goto(`${BASE}/checkin/${eventId}`);
  assert((await s2.textContent("body")).includes("لست ضمن فريق الاستقبال"), "unassigned staff blocked in UI");
  const apiRes = await s2.request.post(`${BASE}/api/checkin`, {
    data: { eventId, raw: primaryCode, method: "SCAN" },
    headers: { Origin: BASE },
  });
  assert(apiRes.status() === 403, "unassigned staff blocked at API: " + apiRes.status());
  const dashRes = await s2.goto(`${BASE}/dashboard/events/${eventId}`);
  assert(dashRes.status() === 404, "unassigned user cannot open organizer event page: " + dashRes.status());
  log("عضو غير معيّن ممنوع من التحضير في الواجهة والخادم ومن لوحة الفعالية");

  // ───────── النتيجة في لوحة المنظّم ─────────
  await org.goto(`${BASE}/dashboard/events/${eventId}`);
  const statsText = await org.textContent(".grid-stats");
  assert(/الحاضرون\s*2/.test(statsText.replace(/\s+/g, " ")), "dashboard shows 2 attended: " + statsText);
  await shot(org, "11-event-overview-desktop");
  await org.goto(`${BASE}/dashboard/events/${eventId}/guests`);
  const guestsText = await org.textContent("main");
  assert(guestsText.includes("الضيف: حضر") && guestsText.includes("المرافق: حضر"), "roster shows guest and companion attendance");
  await shot(org, "12-guests-desktop");
  log("لوحة المنظّم تظهر الحضور الفعلي للضيف والمرافق بوقت كلٍّ منهما");

  // تصدير كشف الحضور
  const csv = await org.request.get(`${BASE}/api/events/${eventId}/export`);
  const csvText = await csv.text();
  assert(csv.ok() && csvText.includes("مرافق — ضيف بمرافق") && csvText.includes("حضر"), "CSV export contains attendance");
  log("تنزيل كشف الحضور CSV");

  // ───────── الرابط العام ─────────
  await org.goto(`${BASE}/dashboard`);
  const pubEventHref = await org.locator(".list-item", { hasText: "ورشة تصميم تجربة المستخدم" }).getAttribute("href");
  await org.goto(`${BASE}${pubEventHref}/billing`);
  const publicUrl = await org.locator(".copy-box input").inputValue();
  const pubPath = new URL(publicUrl).pathname;
  await guest.goto(`${BASE}${pubPath}`);
  await guest.fill("#g-name", "زائر الرابط العام");
  await guest.fill("#g-phone", "0533334444");
  await Promise.all([guest.waitForURL(/\/r\//), guest.click("button[type=submit]")]);
  assert((await guest.locator(".ticket").count()) === 1, "public registration issues ticket");
  log("التسجيل من الرابط العام يصدر تذكرة");

  await guest.goto(`${BASE}${pubPath}`);
  await guest.fill("#g-name", "زائر الرابط العام");
  await guest.fill("#g-phone", "+966533334444");
  await guest.click("button[type=submit]");
  await guest.waitForSelector("text=أنت مسجّل مسبقًا");
  log("نفس الرقم بصيغة مختلفة لا يكرر التسجيل ولا يكشف التذكرة");

  const fullHref = await (async () => {
    await org.goto(`${BASE}/dashboard`);
    const href = await org.locator(".list-item", { hasText: "جلسة إرشاد مهني" }).getAttribute("href");
    await org.goto(`${BASE}${href}/billing`);
    return new URL(await org.locator(".copy-box input").inputValue()).pathname;
  })();
  await guest.goto(`${BASE}${fullHref}`);
  assert((await guest.textContent("body")).includes("اكتمل العدد"), "full public event shows closed state");
  await shot(guest, "13-public-full-mobile");
  log("الرابط العام المكتمل يظهر «اكتمل العدد»");

  // ───────── العزل بين المنظّمين ─────────
  const otherCtx = await browser.newContext({ locale: "ar-SA" });
  const other = await otherCtx.newPage();
  watch(other, "other");
  await login(other, "other@wafda.test");
  const isoRes = await other.goto(`${BASE}/dashboard/events/${eventId}/guests`);
  assert(isoRes.status() === 404, "other organizer gets 404 on foreign event");
  const exportRes = await other.request.get(`${BASE}/api/events/${eventId}/export`);
  assert(exportRes.status() === 404, "other organizer cannot export foreign roster");
  log("منظّم آخر لا يصل لبيانات الفعالية (404)");

  // ───────── زيارة كل الصفحات ─────────
  for (const p of ["", "/guests", "/send", "/waitlist", "/template", "/billing", "/staff", "/edit", "/messages", "/import"]) {
    await expectNoAppError(org, `${BASE}/dashboard/events/${eventId}${p}`);
  }
  for (const p of ["/dashboard/wallet", "/dashboard/designs", "/dashboard/designs/new", "/dashboard/support", "/checkin"]) {
    await expectNoAppError(org, `${BASE}${p}`);
  }
  log("كل صفحات المنظّم تعمل دون أخطاء");

  const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ar-SA" });
  const admin = await adminCtx.newPage();
  watch(admin, "admin");
  await login(admin, "admin@wafda.test");
  assert(admin.url().includes("/admin"), "admin lands on admin panel");
  for (const p of ["/admin", "/admin/users", "/admin/templates", "/admin/designs", "/admin/support", "/admin/settings", "/admin/payments", "/admin/messages", "/admin/audit"]) {
    await expectNoAppError(admin, `${BASE}${p}`);
  }
  await admin.goto(`${BASE}/admin`);
  await shot(admin, "14-admin-desktop");
  // الأدمن يرسل عرض سعر لطلب تصميم
  await admin.goto(`${BASE}/admin/designs`);
  await admin.click(".list-item:has-text('دعوة بهوية النادي')");
  await admin.fill("#amount", "350");
  await clickAndFlash(admin, admin.locator("button:has-text('إرسال العرض')"), "أُرسل عرض السعر");
  await org.goto(`${BASE}/dashboard/designs`);
  assert((await org.textContent("main")).includes("وصل عرض السعر"), "organizer sees quote");
  log("لوحة الأدمن تعمل، وعرض السعر يصل للمنظّم");

  // المنظّم لا يصل للوحة الأدمن
  await org.goto(`${BASE}/admin`);
  assert(org.url().includes("/dashboard"), "organizer redirected away from admin");
  log("المنظّم ممنوع من لوحة الأدمن");

  // لقطات الجوال للوحة المنظّم
  const orgMobileCtx = await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" });
  const orgM = await orgMobileCtx.newPage();
  watch(orgM, "organizer-mobile");
  await login(orgM, "organizer@wafda.test");
  await orgM.goto(`${BASE}/dashboard/events/${eventId}`);
  await shot(orgM, "15-event-overview-mobile");
  const overflow = await orgM.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, "no horizontal scroll on mobile overview: " + overflow);
  log("لوحة المنظّم على الجوال بدون تمرير أفقي");

  if (errors.length) {
    console.error("\nأخطاء المتصفح:\n" + errors.join("\n"));
    throw new Error(`${errors.length} browser errors`);
  }
  console.log(`\nنجح اختبار الرحلة الكاملة (${step} خطوة). اللقطات في: ${SHOTS}`);
} finally {
  await browser.close();
}
