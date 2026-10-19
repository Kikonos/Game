// Crew costs (B2): per diems and hotels daily while away, salaries at month end.

import type { GameState } from '../core/types';

/** Daily: per diem for every crew member away from base, hotel nights at outstations. TODO(B2) */
export function dailyCrewCosts(_g: GameState): void {}

/** Month end: post salaries × (1 + BAL.onCosts) under 'salaries'. TODO(B2) */
export function monthlySalaries(_g: GameState): void {}
