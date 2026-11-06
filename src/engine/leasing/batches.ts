// v0.17 failure batches (UPDATE-0.17.md §J.3; lane `supply`): when an airline fails, its lessors repossess its fleet
// and want it placed fast. An airline failure (a world event, or a client's administration in commercial/crises.ts)
// eases supply of its families for 120 days and, once the last batch is 300 days old, releases 3–6 aircraft of its
// main family: each its own offer with a shared batchId, 8–15 % under market rent and a month less deposit (a mid-life
// lessor accepts one grade lower for these: BAL.v017.batch.gradeRelief, applied by lane deals at the credit check),
// 30 % of them for sale by the administrator at 10–20 % under value, handed over at a storage site 30–120 days on
// (maintenance-slot queues; records × 1.3 in the transition), open 14–30 days. One message for the batch.

import type { RatingFamily } from '../../data/acmiTypes';
import { LESSOR_DEFS } from '../../data/lessors';
import { FAILURE_FLEETS } from '../../data/market';
import { AIRLINE_FAMILIES, AIRLINE_FAMILIES_V016 } from '../../data/naming';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { typeOf } from '../core/perf';
import { chance, int, pick, weightedPick } from '../core/rng';
import { DAY, fmtDay } from '../core/time';
import type { AgeBand, AircraftOffer, GameState, WorldEvent } from '../core/types';
import { bandsFor, makeOffer, postOffer, shortName } from '../ops/market';
import { lockOf } from '../scenario/rules';
import { leasingSide } from './side';
import { gradeNow } from './terms';
import { addSupplyShock } from './tightness';

const B = () => BAL.v017.batch;

/** The mainstream type of each family (what a failed airline's batch is made of). */
export const FAMILY_MAIN: Partial<Record<RatingFamily, string>> = {
  A320: 'a320ceo', B737: 'b738', 'B757/767': 'b763', 'A330/340': 'a332', B777: 'b772', B787: 'b788', A350: 'a359', A380: 'a388', B747: 'b744',
};

/**
 * What a failed airline flies (§J.3): `FAILURE_FLEETS` (Air Moldova, TAROM); a rival's fleet (its commonest type); a
 * client's families (AIRLINE_FAMILIES / _V016: the mainstream narrowbody of its first narrowbody family). `wide`: its
 * widebody type, when it flies one. Null when we know nothing it flies. Pure.
 */
export function failedFleet(g: GameState, e: WorldEvent): { name: string; typeId: string; wide?: string; families: RatingFamily[] } | null {
  const name = e.entity ?? 'An airline';
  const known = FAILURE_FLEETS[name];
  if (known) return { name, typeId: known.typeId, wide: known.wide, families: [typeOf(known.typeId).family, ...(known.wide ? [typeOf(known.wide).family] : [])] };
  const rival = e.rivalId ? g.rivals.find((x) => x.id === e.rivalId) : g.rivals.find((x) => x.name === name);
  if (rival && rival.fleet.length) {
    const fleet = [...rival.fleet].filter((f) => typeOf(f.typeId)).sort((a, b) => b.count - a.count || (a.typeId < b.typeId ? -1 : 1));
    const narrow = fleet.find((f) => typeOf(f.typeId).body === 'narrow');
    const wide = fleet.find((f) => typeOf(f.typeId).body === 'wide');
    const main = narrow ?? fleet[0];
    return { name, typeId: main.typeId, ...(wide && wide !== main ? { wide: wide.typeId } : {}), families: [...new Set(fleet.map((f) => typeOf(f.typeId).family))] };
  }
  const fams = AIRLINE_FAMILIES[name] ?? AIRLINE_FAMILIES_V016[name];
  if (!fams?.length) return null;
  const narrowFam = fams.find((f) => FAMILY_MAIN[f] && typeOf(FAMILY_MAIN[f]!).body === 'narrow');
  const wideFam = fams.find((f) => FAMILY_MAIN[f] && typeOf(FAMILY_MAIN[f]!).body === 'wide');
  const typeId = FAMILY_MAIN[narrowFam ?? wideFam ?? fams[0]];
  if (!typeId) return null;
  return { name, typeId, ...(wideFam && narrowFam ? { wide: FAMILY_MAIN[wideFam] } : {}), families: fams };
}

/**
 * An airline failed (ops/world.ts airlineFailure through onSupplyEvent, or a client's administration in
 * commercial/crises.ts): its families ease for 120 days, and a batch of its aircraft comes to the market when the
 * last batch is at least 300 days old. Rolls on the side stream `batch:<eventId>`.
 */
export function onAirlineFailure(g: GameState, e: WorldEvent): void {
  if (!BAL.v017.on || !g.leasing) return;
  const L = g.leasing;
  const fleet = failedFleet(g, e);
  if (!fleet) return;
  const [delta, days] = BAL.v017.supply.shock.failure;
  addSupplyShock(g, { families: fleet.families, delta, until: g.now + days * DAY, text: `${fleet.name}'s aircraft back with the lessors`, eventId: e.id });
  if (L.lastBatch !== undefined && g.now - L.lastBatch < B().gapDays * DAY) return;
  if (lockOf(g, 'fleet')) return;
  const r = leasingSide(g, `batch:${e.id}`);
  const wide = !!fleet.wide && chance(r, B().wideShare);
  const t = typeOf(wide ? fleet.wide! : fleet.typeId);
  if (!t || !t.available) return;
  const bands: AgeBand[] = bandsFor(g, t).filter((b) => b === 'mid' || b === 'old');
  if (!bands.length) return;
  // The lessors holding the type (mid-life ones first: they buy and place airlines' repossessed fleets).
  const holders = LESSOR_DEFS.filter((l) => l.id !== 'exop' && l.families.includes(t.family) && l.minGrade[t.body] && l.ages.some((a) => bands.includes(a)));
  if (!holders.length) return;
  const batchId = nextId(g, 'bt');
  const n = int(r, B().size[0], B().size[1]);
  const grade = gradeNow(g).grade;
  const offers: AircraftOffer[] = [];
  const open = int(r, B().open[0], B().open[1]);
  for (let i = 0; i < n; i++) {
    const def = weightedPick(r, holders, (l) => (l.tier === 'midLife' ? 3 : 1));
    const band = pick(r, bands.filter((b) => def!.ages.includes(b)).length ? bands.filter((b) => def!.ages.includes(b)) : bands);
    const buy = chance(r, B().buyShare);
    const o = makeOffer(g, t, {
      source: 'batch', batchId, band, grade, lead: B().ready, days: [open, open], exOperator: fleet.name,
      ...(buy ? { kind: 'buy' as const, seller: `${fleet.name}'s administrator` } : { lessorId: def!.id }),
    });
    o.batchOf = fleet.name;
    offers.push(o);
    postOffer(g, o, { quiet: true });
  }
  L.lastBatch = g.now;
  L.stats.batches++;
  const leases = offers.filter((o) => o.kind === 'dryLeaseIn');
  const under = leases.length ? leases.reduce((s, o) => s - (o.why?.find((w) => w.label === 'failure batch')?.pct ?? 0), 0) / leases.length : 0;
  const sales = offers.length - leases.length;
  const ty = shortName(t);
  pushMessage(g, {
    tone: 'info', cat: 'company', topic: 'market', cue: 'offerNew',
    title: `${fleet.name}'s ${ty}s are on the market`,
    body: `${offers.length} aircraft${leases.length ? `, about ${Math.round(under * 100)} % under market rent` : ''}${sales ? ` (${sales} for sale by the administrator)` : ''}. Lessors want them placed fast: a month less deposit. Handed over at storage sites in 1–4 months; open until ${fmtDay(g.now + open * DAY)}.`,
    ref: { kind: 'market', id: offers[0].id },
  });
  requestPause('marketOffer');
}
