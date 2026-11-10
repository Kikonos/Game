// v0.20 the few facts beyond the statement that Finance › At a glance's tips read (engine/finance/glance.ts).

import { isPilot } from '../core/perf';
import type { GameState } from '../core/types';
import { crewPlan, crewUtilisation } from '../crew';
import type { GlanceFacts } from './glance';

/** Crew on the books against the flying's needs, the receivables overdue, the forecast's zero day. Reads only. */
export function glanceFacts(g: GameState, forecast: readonly { t: number; cash: number }[]): GlanceFacts {
  const u = crewUtilisation(g);
  let pilotNeed = 0;
  let cabinNeed = 0;
  for (const p of crewPlan(g)) for (const r of p.roles) {
    if (isPilot(r.role)) pilotNeed += r.need;
    else cabinNeed += r.need;
  }
  const books = Object.values(g.crew).filter((c) => c.status !== 'joining');
  const overdue = g.finance.receivables.filter((r) => r.paid === null && r.due < g.now).reduce((s, r) => s + r.amount, 0);
  const zero = g.company.cash >= 0 ? forecast.find((p) => p.t > g.now && p.cash < 0) : undefined;
  return {
    pilots: { have: books.filter((c) => isPilot(c.role)).length, need: pilotNeed },
    cabin: { have: books.filter((c) => !isPilot(c.role)).length, need: cabinNeed },
    aircraft: u.aircraft,
    pilotHours28: u.avg28.pilots,
    surplusCost: u.surplusCost,
    overdue,
    cashNow: g.company.cash,
    zeroAt: zero ? zero.t : null,
  };
}
