// B1 — Contracts & commercial. Public API for the UI and other modules.

import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { onContractEnd, onContractStart } from './accept';
import { onFlightArrivedContracts } from './billing';
import { seedClients } from './clients';
import { dailyOffers, onOfferExpire, onOfferReply, onOfferSpawn, scheduleNextOffer } from './offers';
import { extendBaseSchedules } from './schedule';

export { acceptOffer, cancelContract, cancelPenalty, contractProgress, counterOffer, declineOffer, leadDays, type ContractProgress } from './accept';
export { billContractMonth, type BillingLine } from './billing';
export { feasibility, feasibilityAll, type CheckId, type CheckLevel, type FeasibilityCheck, type FeasibilityReport, type PositioningPlan } from './feasibility';
export { generateOffer } from './offers';
export { priceProduct, productValue } from './pricing';
export { generateFlights, planPositioning } from './schedule';

function daily(g: GameState) {
  dailyOffers(g);
  extendBaseSchedules(g);
}

export const contractsModule: SimModule = {
  name: 'contracts',
  init(g) {
    // TODO(B1): seed g.rivals from data/naming RIVALS (names for "a rival took it" and sub-charter later).
    seedClients(g);
    scheduleNextOffer(g);
  },
  handlers: {
    day: daily,
    'offer.spawn': onOfferSpawn,
    'offer.expire': onOfferExpire,
    'offer.reply': onOfferReply,
    'contract.start': onContractStart,
    'contract.end': onContractEnd,
    'flight.arr': onFlightArrivedContracts,
  },
};
