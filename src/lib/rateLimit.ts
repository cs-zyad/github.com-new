/**
 * حد بسيط للطلبات في الذاكرة (لكل عملية خادم). كافٍ للتجربة الأولى؛
 * عند التوسع لعدة خوادم يُستبدل بمخزن مشترك (مثل Redis).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return true;
  }
  b.count++;
  return b.count <= max;
}
