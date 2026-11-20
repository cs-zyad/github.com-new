// تشغيل الاختبارات على PostgreSQL للتحقق من التزامن الحقيقي (معاملات متوازية فعليًا).
// الاستخدام: PG_URL=postgresql://postgres:postgres@localhost:5432 npm run test:pg
// ينشئ قاعدة اختبار جديدة باسم فريد (لا يمس أي قاعدة موجودة)، ثم يعيد توليد عميل SQLite في النهاية.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = (process.env.PG_URL || "postgresql://postgres:postgres@localhost:5432").replace(/\/$/, "");
const dbName = `wafda_test_${Date.now()}`;
const url = `${base}/${dbName}?connection_limit=20`;
const pgSchema = "prisma/postgres/schema.prisma";

mkdirSync("prisma/postgres", { recursive: true });
const schema = readFileSync("prisma/schema.prisma", "utf8").replace('provider = "sqlite"', 'provider = "postgresql"');
writeFileSync(pgSchema, schema);

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

let code = 0;
try {
  run(`npx prisma generate --schema ${pgSchema}`);
  run(`npx vitest run`, { TEST_DATABASE_URL: url, TEST_PRISMA_SCHEMA: pgSchema });
} catch {
  code = 1;
} finally {
  run(`npx prisma generate`);
  console.log(`\nقاعدة الاختبار: ${dbName} (يمكن حذفها يدويًا)`);
}
process.exit(code);
