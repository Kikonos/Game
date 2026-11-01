// Perf budgets in tests: the budget as measured on the dev box, times a factor for slower machines. PERF_BUDGET_FACTOR
// sets it; on CI (GitHub's shared runners, slower per core and loaded by the other test workers) it defaults to 2.

import { availableParallelism, loadavg } from 'node:os';

/** The factor perf budgets are scaled by on this machine (1 locally). */
export function perfBudgetFactor(): number {
  const f = Number(process.env.PERF_BUDGET_FACTOR);
  if (Number.isFinite(f) && f > 0) return f;
  return process.env.CI ? 2 : 1;
}

/**
 * v0.14.1 (CODE-07) how loaded the machine is right now: the 1-minute load average per core, within 1–4 (1 when the
 * platform reports no load). Parallel test files and other work on the box slow every test alike.
 */
export function loadFactor(): number {
  const l = loadavg()[0] / Math.max(1, availableParallelism());
  return Number.isFinite(l) ? Math.min(4, Math.max(1, l)) : 1;
}

/**
 * v0.14.1 (CODE-07) a long test's timeout: what it needs on an idle dev box, scaled by the machine (perfBudgetFactor)
 * and the load when the file is collected, so a season-long simulation is not failed for the box being busy.
 */
export function slowTimeout(ms: number): number {
  return Math.round(ms * perfBudgetFactor() * loadFactor());
}
