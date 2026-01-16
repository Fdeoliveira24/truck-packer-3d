export const PLAN_HIERARCHY = {
  Guest: 0,
  Trial: 1,
  Pro: 2,
  Enterprise: 3,
};

export function isPlanAtLeast(plan, minPlan) {
  const a = PLAN_HIERARCHY[String(plan || 'Guest')] ?? 0;
  const b = PLAN_HIERARCHY[String(minPlan || 'Guest')] ?? 0;
  return a >= b;
}
