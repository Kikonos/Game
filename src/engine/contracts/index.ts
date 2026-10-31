// B1 — Contracts & commercial. Public API for the UI and other modules.

import { flightsRev, takeRelink } from '../core/entities';
import type { SimModule } from '../core/module';
import type { Archetype, GameState, SimEvent } from '../core/types';
import { dailyContracts, onContractEnd, onContractStart } from './accept';
import { onFlightArrivedContracts, onMonthContracts } from './billing';
import { loadClients, seedClients, seedRivals } from './clients';
import { dailyOffers, lapseCues, loadCounters, onOfferExpire, onOfferReply, onOfferSpawn, openingOffers, scheduleNextOffer } from './offers';
import { extendBaseSchedules, relinkPositioning } from './schedule';
import { dailyRelations, loadRelations, monthlyRelationDrift } from './relations';
import { loadRivals, onRivalBid, refreshRivals } from './rivals';
import { dailyDryLease, dailyRepeats, dailySubIn } from './missions';

export { acceptOffer, askingPrice, cancelContract, cancelCost, cancelPenalty, contractProgress, counterOffer, declineOffer, leadDays, setPrice, type ContractProgress, type SignOpts } from './accept';
export { paintQuote, paintTermsText, paintWindow, type PaintSlot } from './paintTerms';
export { cabinQuote, cabinTarget, cabinTermsText, rollCabin, termsProduct } from './cabinTerms';
export { billContractMonth, type BillingLine } from './billing';
export { feasibility, feasibilityAll, marketFit, offerRestLine, type MarketFit, type CheckId, type CheckLevel, type FeasibilityCheck, type FeasibilityReport, type PositioningLeg } from './feasibility';
export { fmtPrice, generateOffer, idleWindows, type IdleWindow, type OfferOpts } from './offers';
export { maxPax, seatNeedText } from './plan';
export { counterLift, counterOdds, counterView, type CounterOdds, type CounterView } from './counter';
export { mghLabel, priceProduct, productValue, rateMultiplier } from './pricing';
export { generateFlights, planPositioning, relinkPositioning } from './schedule';
// v0.8 (UPDATE-0.8.md §12).
export {
  bumpClient, clientList, clientView, LEVEL_NAME, LEVEL_ORDER, LEVEL_PERKS, levelChip, levelFor, levelOf, offerClientLine, perkLines, standing, standingFor, STANDING_NAME,
  type ClientLevel, type ClientView, type LevelPerks, type Standing,
} from './relations';
export { markOfferSeen, offerCompetition, rivalList, rivalSummary, rivalView, STYLE_NAME, type RivalStyle, type RivalView } from './rivals';
export { deportationCleanHit, hajjTender } from './missions';
export { warRiskCost } from './missionChecks';
export { answerCall, CALL_MARGIN_X, callPlan, callScore, callScript, declineCall, isCallOffer, whenSaid, type CallPlan, type CallScript } from './call';

function daily(g: GameState) {
  dailyOffers(g);
  dailyContracts(g);
  extendBaseSchedules(g);
  // v0.8 client levels (hysteresis) and company standing; rivals asking us, dry-lease requests, repeat business.
  dailyRelations(g);
  if (!g.gameOver) {
    dailySubIn(g);
    dailyDryLease(g);
    dailyRepeats(g);
  }
}

function monthly(g: GameState, ev: SimEvent) {
  onMonthContracts(g, ev);
  // v0.8 rivals' fleets and load; idle clients drift toward 0.
  refreshRivals(g);
  monthlyRelationDrift(g);
}

/** flightsRev at the last positioning relink (runtime only). */
const relinked = new WeakMap<GameState, number>();

/** v0.8 fix pack: the body jobs ask for (a widebody base or AOG cover, capacity lease, sub-charter in, Hajj, Antarctica). */
const ASKS_BODY = new Set<Archetype>(['seasonBase', 'aogCover', 'capacityLease', 'subcharterIn', 'hajj', 'antarctic']);

/**
 * v0.8 fix pack, older saves (once): `requirements.body` used to describe the reference type of every job; it now means
 * the client asks for one (feasibility checks it). Offers and contracts that never asked lose it (seats decide).
 */
function loadBodies(g: GameState): void {
  if (g.stats.bodyAsked) return;
  g.stats.bodyAsked = true;
  for (const x of [...Object.values(g.offers), ...Object.values(g.contracts)]) {
    const r = x.requirements;
    if (!r?.body || x.product?.kind === 'dry') continue;
    if (x.archetype === 'hajj' || (r.body === 'wide' && ASKS_BODY.has(x.archetype))) continue;
    delete r.body;
  }
}

export const contractsModule: SimModule = {
  name: 'contracts',
  init(g) {
    seedClients(g);
    seedRivals(g);
    // v0.8 rival styles and client records, levels and standing exactly as load sets them.
    loadRivals(g);
    loadRelations(g);
    g.stats.bodyAsked = true;
    openingOffers(g);
    scheduleNextOffer(g);
  },
  load(g) {
    g.rivals ??= [];
    if (!g.rivals.length) seedRivals(g);
    loadClients(g);
    loadRivals(g);
    loadRelations(g);
    loadCounters(g);
    loadBodies(g);
  },
  /** Keeps empty legs linking commitments after any flight change (delays, swaps, cancellations by other modules). */
  settle(g, full) {
    lapseCues(g);
    const marks = takeRelink(g);
    if (relinked.get(g) === flightsRev(g)) return;
    // Relinked to a fixed point (a pass that changes nothing), so the first settle after a load finds nothing to
    // redo and a reloaded game plays on identically. v0.7: between two events, legs only going off or on blocks
    // relink just their aircraft; a full settle (the end of advanceTo, every player action) relinks the fleet.
    const all = full || marks.all || !relinked.has(g);
    for (const id of Object.keys(g.fleet)) {
      if (!all && !marks.ids.has(id)) continue;
      for (let i = 0; i < 3; i++) {
        const rev = flightsRev(g);
        relinkPositioning(g, id);
        if (flightsRev(g) === rev) break;
      }
    }
    if (all) relinked.set(g, flightsRev(g));
  },
  handlers: {
    day: daily,
    month: monthly,
    'rival.bid': onRivalBid,
    'offer.spawn': onOfferSpawn,
    'offer.expire': onOfferExpire,
    'offer.reply': onOfferReply,
    'contract.start': onContractStart,
    'contract.end': onContractEnd,
    'flight.arr': onFlightArrivedContracts,
  },
};
