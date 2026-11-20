// البناء على Vercel: يحوّل المخطط إلى PostgreSQL (المحلي يبقى SQLite)، يجهّز الجداول،
// يعبّئ البيانات التجريبية مرة واحدة (إن كان DEMO_MODE=true)، ثم يبني Next.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL || "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error(
    "\n✗ DATABASE_URL غير موجود أو ليس PostgreSQL.\n" +
      "  من لوحة Vercel: Storage ← Create Database ← Neon (Postgres) ← Connect للمشروع، ثم Redeploy.\n",
  );
  process.exit(1);
}

// db push يحتاج اتصالًا مباشرًا (غير مجمّع) إن توفر
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || "";
let schema = readFileSync("prisma/schema.prisma", "utf8").replace('provider = "sqlite"', 'provider = "postgresql"');
if (direct) schema = schema.replace('url      = env("DATABASE_URL")', 'url      = env("DATABASE_URL")\n  directUrl = env("WAFDA_DIRECT_URL")');
mkdirSync("prisma/postgres", { recursive: true });
writeFileSync("prisma/postgres/schema.prisma", schema);

const env = { ...process.env, WAFDA_DIRECT_URL: direct, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });

run("npx prisma generate --schema prisma/postgres/schema.prisma");
// بدون --accept-data-loss: أي تغيير يحذف بيانات يوقف البناء بدل أن يحذفها
run("npx prisma db push --skip-generate --schema prisma/postgres/schema.prisma");
if ((process.env.DEMO_MODE ?? "true") === "true") run("npx tsx prisma/seed.ts");
run("npx next build");
