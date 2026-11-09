// v0.19 the bot's scheduled routes (docs/UPDATE-0.19.md §L): with --routes, from day 60 a widebody that stood idle at
// home (≥ 30 of the last 60 days, nothing booked for the next 60) gets LIS–OXB: the full study, Go when the business
// case's P50 is positive, the recommended timetable on that aircraft's type and cabin, fare level Market. A second
// route (TMS for STP Airways) once OXB had three positive months and another widebody idles. DIL only with
// --routes=dil. Conflicts with ACMI work take the cheapest choice (contracts/accept). The report's Network block.

import { BAL } from '../../src/engine/core/balance';
import { typeOf } from '../../src/engine/core/perf';
import { DAY, fmtDate, monthKey } from '../../src/engine/core/time';
import type { GameState } from '../../src/engine/core/types';
import { liveFlightsOf } from '../../src/engine/core/entities';
import { acmiNetBH, answerSlot, businessCase, caseDraft, chainOf, customId, decideCase, marketById, startStudy } from '../../src/engine/network';
import { distanceNm } from '../../src/engine/core/geo';
import { blockMinutes, maxSectorNm } from '../../src/engine/core/perf';
import type { Route } from '../../src/engine/network/types';

const DIL = process.argv.includes('--routes=dil');
/** v0.19.2 --custom-route[=LIS-LUX]: after OXB the bot builds this route itself (the builder's custom market). */
const CUSTOM = (() => {
  const a = process.argv.find((x) => x === '--custom-route' || x.startsWith('--custom-route='));
  if (!a) return null;
  const [from, to] = (a.split('=')[1] ?? 'LIS-LUX').split('-');
  return customId({ from, to });
})();
const k = (v: number) => `${Math.round(v / 1000)}k`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * An idle aircraft for a route (a widebody first, else a narrowbody of 150+ seats that reaches the market): no flying on
 * 25 of the last 60 days, and under half of the next 60 days booked.
 */
function idleWide(g: GameState, exclude: Set<string>, marketId = 'LIS-OXB'): string | null {
  const day = Math.floor(g.now / DAY);
  const m = marketById(marketId);
  const reach = (typeId: string) => !!m && [...chainOf(m, 'out'), ...chainOf(m, 'back').slice(1)].every((x, i, a) => i === 0 || distanceNm(a[i - 1], x) <= maxSectorNm(typeId, a[i - 1], x));
  const list = Object.values(g.fleet).filter((ac) => ac.cabin.total >= 150 && reach(ac.typeId)).sort((a, b) => (typeOf(b.typeId)?.body === 'wide' ? 1 : 0) - (typeOf(a.typeId)?.body === 'wide' ? 1 : 0) || (a.id < b.id ? -1 : 1));
  for (const ac of list) {
    if (exclude.has(ac.id) || ac.status === 'leasedOut' || ac.status === 'delivering' || ac.sale) continue;
    // Idle: no flying on 25 of the last 60 days, and under half of the next 60 days booked.
    const flew = new Set((ac.bhDays ?? []).filter(([d, m]) => d > day - 60 && m > 0).map(([d]) => d));
    if (60 - flew.size < 25) continue;
    const busyDays = new Set(liveFlightsOf(g, ac.id).filter((f) => f.std < g.now + 60 * DAY && f.status !== 'cancelled').map((f) => Math.floor(f.std / DAY)));
    if (busyDays.size > 30) continue;
    return ac.id;
  }
  return null;
}

const live = (g: GameState) => Object.values(g.network?.routes ?? {}).filter((r) => r.status !== 'closed');

/** One bot day on the network. Returns true when it did something. */
export function botNetwork(g: GameState): boolean {
  if (!BAL.v019.on || g.now - g.started < 60 * DAY) return false;
  let did = false;
  const routes = live(g);
  const used = new Set(routes.flatMap((r) => r.series.map((s) => s.tail).filter((x): x is string => !!x)));
  // Decisions waiting: the business case, a slot offer.
  for (const r of routes) {
    if (r.status === 'case') {
      const d = caseDraft(g, r.id);
      const ac = idleWide(g, used, r.marketId);
      if (d && ac) {
        d.typeId = g.fleet[ac].typeId;
        d.layout = g.fleet[ac].cabin.layout;
        const bc = businessCase(g, r.id, d);
        if (bc && bc.p50.result > 0) {
          decideCase(g, r.id, 'go', d);
          if (r.series[0]) r.series[0].tail = ac;
          used.add(ac);
        } else decideCase(g, r.id, 'shelve');
        did = true;
      } else if (d && g.now - (r.study?.done ?? g.now) > 30 * DAY) {
        decideCase(g, r.id, 'shelve');
        did = true;
      }
    }
    if (r.stages.some((s) => s.id === 'slots' && s.state === 'waiting')) {
      answerSlot(g, r.id, true);
      did = true;
    }
  }
  // A new route on an idle widebody: OXB first, TMS after three good months on OXB, DIL only when asked.
  const has = (id: string) => routes.some((r) => r.marketId === id) || Object.values(g.network?.routes ?? {}).some((r) => r.marketId === id && r.closed && g.now - r.closed < 120 * DAY);
  const goodMonths = (id: string) => {
    const r = routes.find((x) => x.marketId === id);
    return r ? Object.values(r.pnl).filter((p) => p.sectors && p.result > 0).length : 0;
  };
  const next = !has('LIS-OXB') ? 'LIS-OXB' : CUSTOM && !has(CUSTOM) ? CUSTOM : !has('LIS-TMS') && goodMonths('LIS-OXB') >= 3 ? 'LIS-TMS' : DIL && !has('LIS-DIL') ? 'LIS-DIL' : null;
  if (next && g.company.homeBase === 'LIS' && !routes.some((r) => r.status === 'study' || r.status === 'case') && idleWide(g, used, next)) {
    const res = startStudy(g, next, 'full');
    if (res.routeId) did = true;
  }
  return did;
}

/** The report's Network block (§L) with the §M balance lines. */
export function botNetworkReport(g: GameState): string {
  const N = g.network;
  const all = Object.values(N?.routes ?? {});
  if (!all.length) return '== network: no routes';
  const out: string[] = ['== network'];
  for (const r of all) {
    const months = Object.entries(r.pnl).map(([m, p]) => ({ m: +m, p })).sort((a, b) => a.m - b.m);
    // Closed months only (the open month has its revenue but not yet its overheads, aircraft time and result).
    const flown = months.filter((x) => x.p.sectors > 0 && x.m < monthKey(g.now));
    const sum = (f: (p: Route['pnl'][number]) => number, xs = flown) => xs.reduce((a, x) => a + f(x.p), 0);
    const rev = sum((p) => p.rev);
    const direct = sum((p) => p.direct);
    const acT = sum((p) => p.acTime);
    const result = sum((p) => p.result);
    const bh = sum((p) => p.bh);
    const launch = months.reduce((a, x) => a + x.p.launch, 0);
    const pax = sum((p) => p.pax);
    const seats = sum((p) => p.seats);
    const rots = r.rotations;
    const typeId = r.series[0]?.typeId ?? 'b763';
    const contribBH = bh ? (rev - direct) / bh : 0;
    const acmi = acmiNetBH(g, typeId);
    // After the ramp: months 4+ of flying.
    const after = flown.slice(3);
    const afterRev = sum((p) => p.rev, after);
    const afterRes = sum((p) => p.result, after);
    const first3 = flown.slice(0, 3);
    // The launch months carry the launch spend (study, permits, campaign, stations).
    const f3 = sum((p) => p.rev, first3) ? (sum((p) => p.result, first3) - launch) / sum((p) => p.rev, first3) : 0;
    const perMonth = after.length ? afterRes / after.length : 0;
    const payback = perMonth > 0 ? launch / perMonth : Infinity;
    const firstDep = rots.find((x) => x.status === 'flown')?.dep;
    // Own-flown rotations only (a sub-chartered one has no block hours of ours and the rival's price as its cost).
    const own = rots.filter((x) => x.status === 'flown' && !x.operatedBy);
    const ownC = own.reduce((a, x) => a + x.sectors.reduce((b, q) => b + (q.rev ?? 0) - (q.cost ?? 0), 0), 0);
    const ownBH = own.reduce((a, x) => a + x.sectors.reduce((b, q) => b + blockMinutes(typeId, q.from, q.to) / 60, 0), 0);
    const ownPerBH = ownBH ? ownC / ownBH : 0;
    const ownRot = own.length ? ownC / own.length : 0;
    out.push(`route ${r.marketId} ${r.model} ${typeId}${r.series[0]?.tail ? ` ${g.fleet[r.series[0].tail]?.reg ?? ''}` : ''} ${r.status} opened ${fmtDate(r.opened)} first ${firstDep ? fmtDate(firstDep) : '-'} months ${flown.length} · rotations flown ${rots.filter((x) => x.status === 'flown').length} cancelled ${rots.filter((x) => x.status === 'cancelled').length} sub ${rots.filter((x) => x.operatedBy).length} · LF ${seats ? pct(pax / seats) : '-'} yield ${pax ? Math.round(sum((p) => p.tickets) / pax) : 0} · rev ${k(rev)} direct ${k(direct)} acTime ${k(acT)} result ${k(result)} margin ${rev ? pct(result / rev) : '-'} · contribution/BH ${Math.round(contribBH)} vs ACMI net/BH ${acmi} · launch ${k(launch)} payback ${Number.isFinite(payback) ? `${payback.toFixed(1)} mo` : 'never'} · rep ${Math.round(r.reputation)}`);
    out.push(`  months: ${flown.map((x) => `${x.m % 12 + 1}/${String(Math.floor(x.m / 12)).slice(2)} ${k(x.p.result)} ${x.p.seats ? Math.round((x.p.pax / x.p.seats) * 100) : 0}%`).join(' ')}`);
    const rotContrib = flown.length ? (rev - direct) / Math.max(1, rots.filter((x) => x.status === 'flown').length) : 0;
    const M = (name: string, ok: boolean, v: string) => out.push(`  balance ${name}: ${v} ${ok ? 'ok' : 'NO'}`);
    if (r.marketId === 'LIS-OXB' && after.length >= 3) M('OXB margin after ramp 2–8 %', afterRev > 0 && afterRes / afterRev >= 0.02 && afterRes / afterRev <= 0.08, afterRev ? pct(afterRes / afterRev) : '-');
    if (flown.length >= 3) M('first 3 months with launch spend −20…+2 %', f3 >= -0.2 && f3 <= 0.02, pct(f3));
    if (ownBH) M('own-flown contribution/BH ≤ ACMI net/BH', ownPerBH <= acmi, `${Math.round(ownPerBH)} vs ${acmi} (${own.length} rotations)`);
    if (own.length) M('own-flown rotation contribution $35–70k', ownRot >= 35_000 && ownRot <= 70_000, k(ownRot));
    void rotContrib;
    if (r.model !== 'partner' && launch) M('launch spend $250–400k', launch >= 250_000 && launch <= 400_000, k(launch));
    if (after.length >= 3) M('payback 12–24 months', payback >= 12 && payback <= 24, Number.isFinite(payback) ? `${payback.toFixed(1)} mo` : 'never');
    const go = r.stages.find((s) => s.id === 'case')?.due;
    if (go && firstDep) M('launch 16–26 weeks', (firstDep - go) / (7 * DAY) >= 10 && (firstDep - go) / (7 * DAY) <= 26, `${((firstDep - go) / (7 * DAY)).toFixed(1)} wk`);
  }
  const s = N!.stats;
  out.push(`network stats launched ${s.launched} rotations ${s.rotations} pax ${s.pax} swaps ${s.swaps} subs ${s.subs} moves ${s.moves} cancels ${s.cancels} downgrades ${s.downgrades} · unearned ${k(all.reduce((a, r) => a + r.unearned, 0))}`);
  return out.join('\n');
}
