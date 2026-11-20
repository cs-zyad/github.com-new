import { execSync } from "node:child_process";

/** ينشئ الجداول في قاعدة الاختبار الجديدة (قاعدة فارغة لكل تشغيل، بدون أي إعادة ضبط) */
export default function setup() {
  const url = process.env.WAFDA_TEST_DB_URL!;
  const schema = process.env.TEST_PRISMA_SCHEMA ?? "prisma/schema.prisma";
  execSync(`npx prisma db push --skip-generate --schema ${schema}`, {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
