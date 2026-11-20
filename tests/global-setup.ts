/** يتأكد أن محاكي Firestore يعمل قبل الاختبارات */
export default async function setup() {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
  try {
    const r = await fetch(`http://${host}/`);
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    throw new Error(`محاكي Firestore لا يعمل على ${host}. شغّل: npm test (يشغّل المحاكي تلقائيًا) أو npm run emulators`);
  }
}
