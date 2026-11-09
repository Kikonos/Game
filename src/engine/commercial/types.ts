// v0.14 Update 2 "Commercial": the saved state of tenders, sales trips and client crises (g.com, optional: older
// saves load with `??=` defaults in commercial/state.ts).

import type { MarketId } from '../../data/markets';
import type { BrokerId, BrokerRel, ContractOffer, HeadCandidate, Lead, Minute, Pitch, SalesRep } from '../core/types';

/** A seat on an airline (same shape as a crew ticket: on the hour, door-to-door minutes from ops/commercial.ts). */
export interface TravelTicket {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
}

export type TenderStatus = 'open' | 'closed' | 'won' | 'lost' | 'noBid' | 'withdrawn';

/** Our bid: rate per BH, MGH a month, the tail, the crew and the dates we offer. */
export interface TenderBid {
  rate: number;
  mgh: number;
  aircraftId: string;
  /** 'ours': all our crew; 'mixed': the client's cabin crew with our pilots and purser (−$75/BH each). */
  crew: 'ours' | 'mixed';
  start: Minute;
  end: Minute;
  at: Minute;
}

export interface RivalTenderBid {
  rivalId: string;
  /** Rate as a share of the client's budget, and MGH as a share of its ask. */
  rateX: number;
  mghX: number;
  quality: number;
  /** Aircraft age (years) it would bring. */
  age: number;
}

/** v0.19.4 the widebody RFPs: Hajj airlifts, Ramadan Umrah lift, summer transatlantic and winter long-haul leisure cover. */
export type WideTenderKind = 'hajj' | 'umrah' | 'summerLong' | 'winterLong';

export interface Tender {
  id: string;
  /** 'S2028' summer round, 'W2027' winter round. */
  round: string;
  clientId: string;
  /** The client's ask: a season-base offer, never on the market (start, end, base, waves, seats, budget rate, MGH). */
  ask: ContractOffer;
  issued: Minute;
  deadline: Minute;
  resultAt: Minute;
  /** A private invitation from a sales trip (fewer rivals). v0.16 or from a broker (its relation grows when we win). */
  invited?: boolean;
  brokerId?: BrokerId;
  /** What the client prefers: its own family (crew commonality), and its cabin crew on board (language). */
  family?: string;
  mixedPref?: boolean;
  /** v0.19.4 a widebody RFP (commercial/tenders.ts issueWideTender): its kind, the dates fixed by the calendar (Hajj:
   *  the bid takes the ask's dates), and its name when it is not the round's ('Hajj 1450', 'Ramadan 2030'). */
  wide?: true;
  kind?: WideTenderKind;
  fixed?: true;
  label?: string;
  rivals: RivalTenderBid[];
  bid?: TenderBid;
  status: TenderStatus;
  result?: {
    /** 'us' or the rival id. */
    winner: string;
    why: string;
    /** Our score and the winner's (0–1-ish), for the results list. */
    ours?: number;
    best?: number;
    /** The offer put back on the market for us (won), and the contract once signed. */
    offerId?: string;
    contractId?: string;
    /** v0.14.1 awarded too late for our start (the dates moved; no relation lost if it lapses). */
    late?: boolean;
  };
}

export type TripKind = 'fair' | 'visit';
export type TripStatus = 'planned' | 'away' | 'done' | 'cancelled';
/** Who travels: you (the accountable manager) or the commercial analyst. */
export type Traveller = 'ceo' | 'analyst';

export interface TripLead {
  clientId: string;
  /** v0.16 'lead': a pipeline lead (commercial/sales.ts); 'offer' is from before v0.16 (a lead was an offer at once). */
  kind: 'offer' | 'rfp' | 'lead';
  offerId?: string;
  tenderId?: string;
  leadId?: string;
}

export interface SalesTrip {
  id: string;
  who: Traveller;
  name: string;
  kind: TripKind;
  /** The fair (data/fairs.ts) or the client visited. */
  fairId?: string;
  clientId?: string;
  /** Where (airport), and the days of meetings [start, end). */
  at: string;
  start: Minute;
  end: Minute;
  out: TravelTicket;
  back: TravelTicket;
  booked: Minute;
  /** Costs: tickets and pass at booking, hotel and per diem on return. */
  cost: { tickets: number; pass: number; hotel: number; perDiem: number };
  status: TripStatus;
  /** v0.14.1 in our home city: no flights (out and back are the hour before and after the meetings, at home). */
  local?: boolean;
  /** Results (on return). v0.14 `presence`: the markets it made us better known in [market, points]. */
  met?: string[];
  presence?: [string, number][];
  leads?: TripLead[];
  why?: string;
}

export type CrisisKind = 'strike' | 'bankruptcy' | 'grounding';

export interface Crisis {
  id: string;
  kind: CrisisKind;
  clientId: string;
  /** Its world event (g.world.events). */
  eventId: string;
  start: Minute;
  end: Minute;
  /** Bankruptcy: receivables written off, and the claim in the administration. */
  written?: number;
  claim?: { amount: number; payAt: Minute; paid?: Minute; pct: number };
  /** Grounding: the engine and how many aircraft. */
  engine?: string;
  grounded?: number;
}

export interface CommercialState {
  tenders: Tender[];
  trips: SalesTrip[];
  crises: Crisis[];
  /** RFPs issued per round ('S2028' → 4). */
  rounds?: Record<string, number>;
  /** v0.19.4 widebody RFPs issued per round (counted apart from the narrowbody ones). */
  wideRounds?: Record<string, number>;
  lastCrisis?: Minute;
  /** v0.14 market presence 0–100 by market (commercial/presence.ts); seeded on a new game or the first load. */
  presence?: PresenceState;
  stats?: { bids: number; won: number; lost: number; trips: number; leads: number; crises: number; written: number };
  // ---------- v0.16 sales (UPDATE-0.16.md §C; commercial/sales.ts). load: ??= empty ----------
  /** Broker relationships by broker (absent = not registered with them). */
  brokers?: Partial<Record<BrokerId, BrokerRel>>;
  /** The leads pipeline (cold and lost ones pruned after 30 days). */
  leads?: Lead[];
  /** Pre-season pitches made. */
  pitches?: Pitch[];
  /** Regional sales managers; candidates by market while hiring; the last dismissal. */
  reps?: SalesRep[];
  repCandidates?: Record<string, HeadCandidate[]>;
  repFiredAt?: Minute;
}

/** v0.14 how well known we are in each market (0–100), and the last day it was updated. */
export interface PresenceState {
  m: Partial<Record<MarketId, number>>;
  day: number;
}
