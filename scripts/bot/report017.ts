// v0.17 the bot's market report (UPDATE-0.17.md §O.7; lane `market-ui`), read from the state at the end of a run and
// the bot's tally (bot/market.ts):
// v0.17 market: grade by quarter C C B B · rating B (63) · rfps 6 (answers P 7 / later 2 / none 14 / rating 5 / cap 1) ·
//   lois 5 signed 4 walked 0 declined 1 · transition median 34 d (camo wait 0) · variations 0 · short-term 1 ·
//   batches 1 · calls N 19 / W 4 · min-hours $42K
// v0.17 narrowNeedToService: 118 96 (median 107 d) · wide 2 (deals 0) · greedy rfps 12 lois 3 · exotic rfps 4 proposals 1 signed 0

import { DAY } from '../../src/engine/core/time';
import type { GameState } from '../../src/engine/core/types';
import { lessorRating } from '../../src/engine/leasing';
import { typeOf } from '../../src/engine/core/perf';
import { MARKET_TALLY } from './market';

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const k = (v: number) => `$${Math.round(v / 1000)}K`;

/** The days from the first growth need to in service (home from the delivery ferry), per growth aircraft. */
export function narrowNeedToService(g: GameState): number[] {
  const out: number[] = [];
  for (const x of MARKET_TALLY.growth) {
    const ac = x.aircraftId ? g.fleet[x.aircraftId] : undefined;
    const home = ac?.delivery?.arrived ?? (ac && ac.status !== 'delivering' && !ac.delivery ? ac.deliveredAt : undefined);
    if (home === undefined) continue;
    out.push(Math.round((home - g.started) / DAY) - x.needAt);
  }
  return out;
}

export function botMarketReport(g: GameState): string {
  const r = lessorRating(g);
  const L = g.leasing;
  if (!L) return `v0.17 market: lessor rating ${r.grade} (${r.score}) · no leasing state`;
  const s = L.stats;
  const a = s.answers;
  const n = (x: string) => a[x] ?? 0;
  const deals = L.deals;
  const signed = deals.filter((d) => d.stage === 'signed').length;
  // Transition days (slot to ready) and the CAMO waits of every aircraft with a transition plan.
  const ind = Object.values(g.fleet).filter((x) => x.induction).map((x) => x.induction!);
  const days = ind.map((i) => Math.round((i.ready - i.slot) / DAY));
  const wait = ind.reduce((t, i) => t + i.waitedCamo, 0);
  const vars = (g.company.aocVariations ?? []).length;
  const line1 = `v0.17 market: grade by quarter ${MARKET_TALLY.grades.join(' ') || '-'} · rating ${r.grade} (${r.score}) · rfps ${s.rfps} (answers P ${n('proposal')} / later ${n('later')} / none ${n('none')} / rating ${n('credit')} / cap ${n('exposure')}${n('placed') ? ` / placed ${n('placed')}` : ''}${n('blocked') ? ` / blocked ${n('blocked')}` : ''})`
    + ` · lois ${s.lois} signed ${signed} walked ${s.walked} declined ${s.declined} conditions ${s.conditions} · transition median ${median(days) ?? '-'} d (camo wait ${wait}) · variations ${vars}`
    + ` · short-term ${s.spot} · batches ${s.batches} · calls N ${s.calls.narrow} / W ${s.calls.wide} · min-hours ${k(s.minHoursBilled)}${s.forfeited ? ` · forfeited ${k(s.forfeited)}` : ''}`;
  const need = narrowNeedToService(g);
  const wides = Object.values(g.fleet).filter((x) => typeOf(x.typeId).body === 'wide').length;
  const wideDeals = deals.filter((d) => (d.stage === 'committee' || d.stage === 'conditions' || d.stage === 'approved') && typeOf(d.offer.typeId).body === 'wide').length;
  const ex = L.exotic;
  const line2 = `v0.17 narrowNeedToService: ${need.join(' ') || '-'}${need.length ? ` (median ${median(need)} d)` : ''}${MARKET_TALLY.needAt !== null ? ` · need open since day ${MARKET_TALLY.needAt}` : ''} · wide ${wides} (deals ${wideDeals})`
    + `${MARKET_TALLY.greedy.rfps ? ` · greedy rfps ${MARKET_TALLY.greedy.rfps} lois ${MARKET_TALLY.greedy.lois}` : ''}${ex || MARKET_TALLY.exotic.rfps ? ` · exotic rfps ${ex?.rfps ?? MARKET_TALLY.exotic.rfps} proposals ${ex?.proposals ?? 0} signed ${MARKET_TALLY.exotic.signed}` : ''}`;
  return `${line1}\n${line2}\n${acquisitionsLine(g)}`;
}

/** Balance step: every aircraft that joined, with the days asked → signed → in service, and the deposits held now. */
export function acquisitionsLine(g: GameState): string {
  const start = new Date(Date.UTC(2000, 0, 1) + g.started * 60_000);
  const mon = (d: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d)).toISOString().slice(2, 7);
  const xs = Object.values(MARKET_TALLY.acq).sort((a, b) => (a.signedAt ?? 0) - (b.signedAt ?? 0));
  const items = xs.map((x) => `${x.typeId} ${x.src} ${mon(x.signedAt ?? 0)}${x.askedAt !== undefined ? ` ask d${x.askedAt}` : ''} sign d${x.signedAt}${x.svcAt !== undefined ? ` svc d${x.svcAt}${x.askedAt !== undefined ? ` (${x.svcAt - x.askedAt} d)` : ''}` : ' (delivering)'}`);
  let dep = 0, lc = 0, res = 0;
  for (const ac of Object.values(g.fleet)) {
    const o = ac.ownership;
    if (o.kind !== 'dryLeaseIn') continue;
    if (o.lc) lc += o.lc; else dep += o.deposit ?? 0;
    res += o.reservesDeposit ?? 0;
  }
  const hold = (g.leasing?.deals ?? []).filter((d) => d.stage === 'committee' || d.stage === 'conditions' || d.stage === 'approved').reduce((t, d) => t + d.holding, 0);
  return `v0.17 acquisitions: ${items.join(' · ') || '-'} · deposits held ${k(dep)} (letters of credit ${k(lc)}, reserves deposits ${k(res)}, holding ${k(hold)})`;
}
