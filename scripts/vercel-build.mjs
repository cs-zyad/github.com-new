// البناء على Vercel: يتأكد من ضبط Firebase، يعبّئ البيانات التجريبية مرة واحدة (إن كان DEMO_MODE=true)، ثم يبني Next.
import { execSync } from "node:child_process";

const hasFirebase =
  !!process.env.FIREBASE_SERVICE_ACCOUNT ||
  (!!process.env.FIREBASE_PROJECT_ID && !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY);
if (!hasFirebase) {
  console.error(
    "\n✗ بيانات Firebase غير مضبوطة.\n" +
      "  أضف في Vercel ← Settings ← Environment Variables المتغير FIREBASE_SERVICE_ACCOUNT\n" +
      "  وقيمته محتوى ملف حساب الخدمة (JSON) من Firebase ← Project settings ← Service accounts ← Generate new private key.\n",
  );
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });
if ((process.env.DEMO_MODE ?? "true") === "true") run("npx tsx scripts/seed.ts");
run("npx next build");
