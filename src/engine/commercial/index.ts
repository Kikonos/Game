// v0.14 Update 2 "Commercial": tenders, sales trips and fairs, client crises. One simulation module (daily), after
// contracts and before crew. Its state is g.com (optional; old saves get the defaults on load).

import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { setTravelHook } from '../ops/commercial';
import { dailyCrises, devCrisis } from './crises';
import { loadCommercial } from './state';
import { dailyTenders, issueTender } from './tenders';
import { bookTrip, dailyTrips, fairsAhead, travelLegs } from './trips';
import type { CrisisKind } from './types';

export * from './types';
export { com, comStats, loadCommercial } from './state';
export {
  TENDER, aircraftWanted, bidQuote, decideTender, issueTender, offerWithBid, ourScore, placeBid, roundAt, roundName, tenderBoard, tenderById, tenderRow, withdrawBid,
  type BidAircraft, type BidQuote, type TenderRow, type TenderRound,
} from './tenders';
export { TRIPS, bookTrip, cancelTrip, fairDays, fairsAhead, nextEdition, planTickets, travelLegs, travellers, tripNow, tripQuote, tripTitle, tripsView, type FairView, type TravellerView, type TripQuote } from './trips';
export { CRISIS, clientCrisisCard, crisesOf, crisisKindName, crisisLive, crisisOfEvent, devCrisis, knowsUs, startCrisis } from './crises';

// The map's deadhead layer draws our travellers' airline legs with the crew's (ops/commercial.ts commercialFlightsBetween).
setTravelHook(travelLegs);

function daily(g: GameState): void {
  dailyTrips(g);
  dailyTenders(g);
  dailyCrises(g);
}

export const commercialModule: SimModule = {
  name: 'commercial',
  load(g) {
    loadCommercial(g);
  },
  handlers: { day: daily },
};

// ---------- dev helpers (console: __contrail.dev.tender() / fair() / crisis(kind)) ----------

/** An RFP now (any season; the coming summer round outside one); the tender id ('' when none could be built). */
export function devTender(g: GameState, clientId?: string): string {
  for (let i = 0; i < 6; i++) {
    const t = issueTender(g, { clientId });
    if (t) return t.id;
  }
  return '';
}

/** Books you on the next fair you can reach (or the one named); the trip id ('' when none could be booked). */
export function devFair(g: GameState, fairId?: string): string {
  const list = fairId ? fairsAhead(g).filter((f) => f.id === fairId) : fairsAhead(g);
  for (const f of list) {
    const res = bookTrip(g, 'ceo', { fairId: f.id });
    if (res.ok) return res.data!.tripId;
  }
  return '';
}

/** A crisis now; the world event id. */
export function devCrisisNow(g: GameState, kind: CrisisKind = 'strike', clientName?: string): string {
  return devCrisis(g, kind, clientName);
}

