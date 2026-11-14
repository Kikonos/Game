// v0.14 Update 2 "Commercial": tenders, sales trips and fairs, client crises. One simulation module (daily), after
// contracts and before crew. Its state is g.com (optional; old saves get the defaults on load).

import { fairLead } from './sales';
// v0.20.1 where a job came from (a tender we won, a lead we worked): the tags on offers and contracts.
export { LEAD_NOTE, ORIGIN_LABEL, TENDER_NOTE, contractOrigin, leadSourceLine, offerOrigin, type Origin, type OriginView } from './origin';
import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { setTravelHook } from '../ops/commercial';
import { dailyCrises, devCrisis } from './crises';
import { loadCommercial } from './state';
import { seedMarketClients } from '../contracts/clients';
import { dailyPresence, loadPresence, presence } from './presence';
import { bidQuote, dailyTenders, decideTender, issueTender, issueWideTender, placeBid, roundAt, wideTenderEligible } from './tenders';
import { bookTrip, dailyTrips, fairsAhead, travelLegs } from './trips';
import { dailySales, loadSales, monthlySales, setSalesHooks } from './sales';
import { fleetCouldFly, fleetFitType, generateOffer, leadWindow } from '../contracts/offers';
import { TENDER_ISSUERS, WIDE_ISSUER_NAMES } from '../../data/fairs';
import type { CrisisKind, WideTenderKind } from './types';
import { chance } from '../core/rng';
import { sideOf } from './state';
import { wideShareOf } from '../contracts/fleetFit';

export * from './types';
export { com, comStats, loadCommercial } from './state';
export {
  TENDER, aircraftWanted, bidAircraft, bidQuote, decideTender, hajjTenderFor, issueTender, issueWideTender, offerWithBid, ourScore, placeBid, ramadanOf, roundAt, roundName, tenderBoard, tenderById, tenderRow, umrahTenderFor, wideKindsNow, wideTenderEligible, wideTenderWant, withdrawBid,
  type BidAircraft, type BidQuote, type BidTerms, type TenderRow, type TenderRound,
} from './tenders';
export { TRIPS, bookTrip, cancelTrip, fairDays, fairMeets, fairsAhead, inAudience, nextEdition, planTickets, presenceText, travelLegs, travellers, tripNow, tripQuote, tripTitle, tripsView, visitableClients, type FairView, type TravellerView, type TripQuote } from './trips';
export { PRESENCE, bumpPresence, clientMarket, dailyPresence, fairPresence, homeMarket, marketTilt, presence, presenceIn, presenceView, presenceWeight, presenceWord, type PresenceRow } from './presence';
export { CRISIS, clientCrisisCard, crisesOf, crisisKindName, crisisLive, crisisOfEvent, devCrisis, knowsUs, startCrisis } from './crises';
// v0.16 sales (UPDATE-0.16.md §C): brokers, the leads pipeline, pitches, sales managers.
export {
  BROKER_IDS, BROKER_VISIT, STAGE_NAME, brokerFit, brokerIdOf, brokerLeadsPerMonth, brokerName, brokerView, commissionOf, dropLead, fireSalesRep, hireSalesRep, leadColdCard, leadProblems, leadSourceName, leadsView,
  marketName, pitchAirline, pitchFree, pitchQuota, pitchTargets, pitchWindow, pitchesOf, pitchesView, registerBroker, repCandidates, repRehireDays, salesBill, salesDesk, salesReps, salesRepsView, seasonLabel, visitBroker,
  workLead, workedCap, workedNow, type BrokerView, type LeadView, type PitchTarget, type PitchView, type PitchWindow, type SalesDesk, type SalesRepView,
} from './sales';

// The map's deadhead layer draws our travellers' airline legs with the crew's (ops/commercial.ts commercialFlightsBetween).
setTravelHook(travelLegs);
// v0.16 the sales desk builds its leads' offers and brokers' invited tenders through these (offers.ts and tenders.ts
// import sales.ts: no cycle).
const narrowIssuer = (name: string, kind: 'summer' | 'winter') => TENDER_ISSUERS.some((x) => x.name === name && (kind === 'summer' || !!x.winter));

setSalesHooks({
  offer: (g, archetype, opts) => generateOffer(g, archetype, opts),
  fits: (g, offerId) => fleetCouldFly(g, offerId),
  fitType: (g, offerId) => fleetFitType(g, offerId),
  window: (g, archetype, r, onAc) => leadWindow(g, archetype, r, onAc),
  // v0.19.4 a widebody tenderer invites us to its widebody RFP once we can bid one (else its narrowbody one, if any).
  tender: (g, opts) => {
    const name = opts.clientId ? g.clients[opts.clientId]?.name : undefined;
    const round = roundAt(g.now);
    // An airline that tenders both (Condor, TUI, Saudia…): the body by our fleet's weighted share.
    const both = !!name && !!round && narrowIssuer(name, round.kind);
    const wideFirst = !!name && WIDE_ISSUER_NAMES.has(name) && wideTenderEligible(g) && (!both || chance(sideOf(g, `inv:${opts.clientId}:${Math.floor(g.now / 1440)}`), wideShareOf(g)));
    const wide = wideFirst ? issueWideTender(g, opts) : null;
    if (wide) return wide;
    return !name || !round || narrowIssuer(name, round.kind) ? issueTender(g, opts) : null;
  },
  round: (t) => roundAt(t),
  issuer: (name, kind, g) => narrowIssuer(name, kind) || (WIDE_ISSUER_NAMES.has(name) && wideTenderEligible(g)),
});

function daily(g: GameState): void {
  // v0.14 market presence: the day's jobs and satisfied clients, the slow fade.
  dailyPresence(g);
  dailyTrips(g);
  dailyTenders(g);
  dailyCrises(g);
  // v0.16 brokers' leads, the pipeline's lifetimes, pitch replies, the sales managers' leads (commercial/sales.ts).
  dailySales(g);
}

export const commercialModule: SimModule = {
  name: 'commercial',
  // v0.14 a new company is known in its home market (presence seeded from the base country).
  init(g) {
    seedMarketClients(g);
    presence(g);
    // v0.16 the sales records, empty (exactly as load sets them).
    loadSales(g);
  },
  load(g) {
    loadCommercial(g);
    seedMarketClients(g);
    // v0.14 an older save: presence seeded from its clients and contracts.
    loadPresence(g);
    loadSales(g);
  },
  // v0.16 month end (before ops closes the statement): the sales payroll.
  handlers: { day: daily, month: (g) => monthlySales(g) },
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

/** v0.19.4 a widebody RFP now (of that kind when given: 'hajj', 'umrah', 'summerLong', 'winterLong'); its id or ''. */
export function devWideTender(g: GameState, kind?: WideTenderKind): string {
  for (let i = 0; i < 6; i++) {
    const t = issueWideTender(g, kind ? { kind } : {});
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

/** v0.16.3 a lead now in the pipeline (a client we know, else any), for the Market › Leads screen checks; its id ('' when none). */
export function devLead(g: GameState, clientName?: string): string {
  const cs = Object.values(g.clients).filter((c) => !c.ceased && !c.rivalId && (!clientName || c.name === clientName));
  const c = cs.find((x) => (x.jobs ?? 0) > 0) ?? cs[0];
  if (!c) return '';
  const l = fairLead(g, c, `dev:${g.now}`, null);
  return l?.id ?? '';
}

/** A crisis now; the world event id. */
export function devCrisisNow(g: GameState, kind: CrisisKind = 'strike', clientName?: string): string {
  return devCrisis(g, kind, clientName);
}


/**
 * A tender board with something in each list (screens, the player's console): four RFPs, three bids; one won (signed
 * on the tail bid), one lost to a cheaper rival, one waiting for the award, one open. The tender ids.
 */
export function devTenderBoard(g: GameState): string[] {
  const ids: string[] = [];
  for (let i = 0; i < 12 && ids.length < 4; i++) {
    const t = issueTender(g);
    if (t) ids.push(t.id);
  }
  ids.slice(0, 3).forEach((id, i) => {
    const t = g.com!.tenders.find((x) => x.id === id)!;
    const q = bidQuote(g, id);
    const ac = q?.aircraft.find((a) => a.level !== 'no') ?? q?.aircraft[0];
    if (!q || !ac) return;
    placeBid(g, id, { rate: Math.round((q.budget * (i === 1 ? 1.06 : 0.98)) / 10) * 10, mgh: q.mgh, aircraftId: ac.id, crew: t.mixedPref ? 'mixed' : 'ours', start: q.start, end: q.end });
    if (i === 2) {
      t.status = 'closed';
      t.deadline = g.now;
      return;
    }
    if (i === 0) t.rivals = [];
    else t.rivals = t.rivals.map((r, j) => (j === 0 ? { ...r, rateX: 0.93, quality: 0.96 } : r));
    t.status = 'closed';
    t.deadline = g.now;
    t.resultAt = g.now;
    decideTender(g, t);
  });
  return ids;
}
