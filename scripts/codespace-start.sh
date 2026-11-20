#!/usr/bin/env bash
# تشغيل وفدة تلقائيًا داخل GitHub Codespaces (أو أي بيئة مشابهة):
# يضبط APP_URL على الرابط العام، يجهّز قاعدة البيانات التجريبية أول مرة، يبني ويشغّل الخادم في الخلفية.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  APP_URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  APP_URL="${APP_URL:-http://localhost:${PORT}}"
fi
export APP_URL

if [ ! -f .env ]; then
  cp .env.example .env
fi
# حدّث APP_URL في .env (الرابط يتغير مع كل Codespace)
if grep -q '^APP_URL=' .env; then
  sed -i "s#^APP_URL=.*#APP_URL=\"${APP_URL}\"#" .env
else
  echo "APP_URL=\"${APP_URL}\"" >> .env
fi

[ -d node_modules ] || npm install

# قاعدة البيانات: إن لم تُضبط بيانات Firebase في .env نستخدم محاكي Firestore المحلي
if ! grep -qE '^FIREBASE_SERVICE_ACCOUNT=".+"' .env && [ -z "${FIREBASE_SERVICE_ACCOUNT:-}" ]; then
  export FIRESTORE_EMULATOR_HOST="127.0.0.1:8085"
  if ! curl -s "http://${FIRESTORE_EMULATOR_HOST}/" >/dev/null 2>&1; then
    IMPORT=""; [ -d .emulator-data ] && IMPORT="--import=.emulator-data"
    nohup npx -y firebase-tools@15.37.0 emulators:start --only firestore --project demo-wafda $IMPORT --export-on-exit=.emulator-data > /tmp/wafda-emulator.log 2>&1 &
    for i in $(seq 1 90); do curl -s "http://${FIRESTORE_EMULATOR_HOST}/" >/dev/null 2>&1 && break; sleep 2; done
  fi
fi

npx tsx scripts/seed.ts | tee /tmp/wafda-seed.txt

npm run build > /tmp/wafda-build.log 2>&1

# إيقاف نسخة سابقة إن وُجدت ثم التشغيل في الخلفية
pkill -f "next/dist/bin/next start" 2>/dev/null || true
nohup node node_modules/next/dist/bin/next start -p "$PORT" > /tmp/wafda.log 2>&1 &

# محاولة جعل الرابط عامًا ليفتحه الضيوف من جوالاتهم (قد لا تسمح صلاحية الرمز بذلك — تُغيّر يدويًا من تبويب Ports)
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null 2>&1; then
  gh codespace ports visibility "${PORT}:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
fi

echo "وفدة تعمل على: ${APP_URL}"
