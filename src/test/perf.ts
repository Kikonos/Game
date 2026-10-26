// Perf budgets in tests: the budget as measured on the dev box, times a factor for slower machines. PERF_BUDGET_FACTOR
// sets it; on CI (GitHub's shared runners, slower per core and loaded by the other test workers) it defaults to 2.

/** The factor perf budgets are scaled by on this machine (1 locally). */
export function perfBudgetFactor(): number {
  const f = Number(process.env.PERF_BUDGET_FACTOR);
  if (Number.isFinite(f) && f > 0) return f;
  return process.env.CI ? 2 : 1;
}
