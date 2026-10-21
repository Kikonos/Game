// B1 — Contracts & commercial. Public API for the UI and other modules.

import { flightsRev } from '../core/entities';
import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { dailyContracts, onContractEnd, onContractStart } from './accept';
import { onFlightArrivedContracts, onMonthContracts } from './billing';
import { seedClients, seedRivals } from './clients';
import { dailyOffers, onOfferExpire, onOfferReply, onOfferSpawn, openingOffers, scheduleNextOffer } from './offers';
import { extendBaseSchedules, relinkPositioning } from './schedule';

export { acceptOffer, askingPrice, cancelContract, cancelCost, cancelPenalty, contractProgress, counterOffer, declineOffer, leadDays, type ContractProgress, type SignOpts } from './accept';
export { paintQuote, paintTermsText, paintWindow, type PaintSlot } from './paintTerms';
export { billContractMonth, type BillingLine } from './billing';
export { feasibility, feasibilityAll, marketFit, type MarketFit, type CheckId, type CheckLevel, type FeasibilityCheck, type FeasibilityReport, type PositioningLeg } from './feasibility';
export { fmtPrice, generateOffer, idleWindows, type IdleWindow, type OfferOpts } from './offers';
export { counterOdds, counterView, type CounterOdds, type CounterView } from './counter';
export { priceProduct, productValue, rateMultiplier } from './pricing';
export { generateFlights, planPositioning, relinkPositioning } from './schedule';

function daily(g: GameState) {
  dailyOffers(g);
  dailyContracts(g);
  extendBaseSchedules(g);
}

/** flightsRev at the last positioning relink (runtime only). */
const relinked = new WeakMap<GameState, number>();

export const contractsModule: SimModule = {
  name: 'contracts',
  init(g) {
    seedClients(g);
    seedRivals(g);
    openingOffers(g);
    scheduleNextOffer(g);
  },
  load(g) {
    g.rivals ??= [];
    if (!g.rivals.length) seedRivals(g);
  },
  /** Keeps empty legs linking commitments after any flight change (delays, swaps, cancellations by other modules). */
  settle(g) {
    if (relinked.get(g) === flightsRev(g)) return;
    // Relinked to a fixed point (a pass that changes nothing), so the first settle after a load finds nothing to
    // redo and a reloaded game plays on identically.
    for (const id of Object.keys(g.fleet)) {
      for (let i = 0; i < 3; i++) {
        const rev = flightsRev(g);
        relinkPositioning(g, id);
        if (flightsRev(g) === rev) break;
      }
    }
    relinked.set(g, flightsRev(g));
  },
  handlers: {
    day: daily,
    month: onMonthContracts,
    'offer.spawn': onOfferSpawn,
    'offer.expire': onOfferExpire,
    'offer.reply': onOfferReply,
    'contract.start': onContractStart,
    'contract.end': onContractEnd,
    'flight.arr': onFlightArrivedContracts,
  },
};
