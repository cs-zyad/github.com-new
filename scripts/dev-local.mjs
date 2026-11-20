// التشغيل المحلي الكامل بدون حساب Firebase: محاكي Firestore + بيانات تجريبية + next dev.
// البيانات تُحفظ في .emulator-data بين مرات التشغيل. يحتاج Java 11+ (للمحاكي).
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const args = ["-y", "firebase-tools@15.37.0", "emulators:exec", "--only", "firestore", "--project", "demo-wafda", "--export-on-exit=.emulator-data"];
if (existsSync(".emulator-data")) args.push("--import=.emulator-data");
args.push("npm run db:seed && next dev");
const p = spawn("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
p.on("exit", (code) => process.exit(code ?? 0));
