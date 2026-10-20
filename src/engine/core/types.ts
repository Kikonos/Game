// Game state for CONTRAIL ACMI. Everything here is plain JSON (saved with lz-string).
// Shared contract between the engine modules and the UI: see docs/acmi/DESIGN.md §2.
// Builders may ADD optional fields in their own domain section; renames/removals go through the architect.

import type { CabinLayout, RatingFamily } from '../../data/acmiTypes';

// ======================================================================
// Time
// ======================================================================

/** Integer game minutes since EPOCH (1 Jan 2000 00:00 UTC). The UI may hold fractional minutes. */
export type Minute = number;
/** year * 12 + month0 (UTC). */
export type MonthKey = number;

// ======================================================================
// Brand (kept from the airline game: AircraftArt, TailBadge and the livery picker use these)
// ======================================================================

export type TailStyle = 'solid' | 'split' | 'stripe' | 'sweep';

export interface Livery {
  primary: string;
  secondary: string;
  tail: TailStyle;
}

// ======================================================================
// Company
// ======================================================================

export type ApprovalId =
  | 'etops120' | 'etops180' | 'etops240' | 'augmented' | 'ulr' | 'iosa' | 'dg'
  | 'areaAfrica' | 'areaAsia' | 'areaAmericas' | 'un' | 'defence' | 'vip' | 'hajj' | 'polar' | 'cabinCargo';

export interface PendingApproval {
  id: ApprovalId;
  started: Minute;
  done: Minute;
  cost: number;
}

export interface Reputation {
  /** Dispatch reliability, on-time, crew quality (0–100). */
  reliable: number;
  /** Public/moral standing; deportation and grey work lower it (0–100). */
  clean: number;
}

export type HotelTier = 3 | 4 | 5;

export interface Policies {
  /** Extra cabin crew above the legal minimum on every flight (0–2). */
  extraCabin: number;
  hotelTier: HotelTier;
  /** Per diem level in % of the BAL per-role rates (80–150; 100 = market). */
  perDiemPct: number;
  /** Target deployment length before rotating crew home (weeks). */
  rotationWeeks: 4 | 5 | 6;
  /** Auto-roster new and changed flights. */
  autoRoster: boolean;
  /** Auto-plan A-checks (C-checks always need the player). */
  autoMaintenance: boolean;
  /** Let the auto-roster use "tight" duties (within 30 min of a limit). */
  allowTight: boolean;
  /** Buy short-notice positioning tickets automatically. */
  autoDeadhead: boolean;
}

/** Department heads arrive in v0.6; the shape is reserved so saves stay compatible. */
export interface Department {
  id: 'commercial' | 'crewPlanning' | 'chiefPilot' | 'cabin' | 'technical';
  headName: string | null;
  skill: number;
  salary: number;
}

export interface Company {
  name: string;
  /** Two-character code painted on the tail. */
  code: string;
  /** Three-letter ICAO designator used in flight numbers. */
  icao: string;
  callsign: string;
  ceo: string;
  livery: Livery;
  homeBase: string;
  /** Registration prefix of the AOC state, e.g. 'CS-'. */
  regPrefix: string;
  cash: number;
  reputation: Reputation;
  approvals: ApprovalId[];
  pendingApprovals: PendingApproval[];
  policies: Policies;
  departments: Department[];
  /** Next numeric flight number for own-designator flights. */
  nextFlightNo: number;
}

// ======================================================================
// Fleet
// ======================================================================

export type Ownership =
  | { kind: 'owned'; bookValue: number }
  | { kind: 'dryLeaseIn'; lessor: string; rentPerMonth: number; reservesPerFH: number; leaseStart: Minute; leaseEnd: Minute; /** B3: refundable deposit paid at signing. */ deposit?: number };

export interface Cabin {
  /** Seats per class. */
  j: number;
  w: number;
  y: number;
  total: number;
  /** '180Y', '16J/251Y'… */
  label: string;
  layout: CabinLayout;
}

export interface MaintCounters {
  /** Flight hours since the last A-check. */
  fhSinceA: number;
  lastA: Minute;
  fhSinceC: number;
  lastC: Minute;
  /** 0–1 deferred defects backlog; raises AOG risk, cleared by checks. */
  deferred: number;
  /** B3: smallest C-check warning threshold already sent (days), and the last A-check no-slot warning. */
  cWarned?: number;
  aWarned?: Minute;
}

export type AircraftStatus = 'available' | 'flying' | 'maintenance' | 'aog' | 'delivering' | 'stored' | 'leasedOut';

export interface Aircraft {
  id: string;
  /** Registration, e.g. 'CS-TQA'. */
  reg: string;
  typeId: string;
  /** Optional nickname. */
  name?: string;
  ownership: Ownership;
  builtYear: number;
  /** Total airframe flight hours and cycles. */
  hours: number;
  cycles: number;
  maint: MaintCounters;
  cabin: Cabin;
  /** Highest ETOPS this airframe is configured for (approval is company-wide). */
  etops: number;
  /** Airport where it is parked, or where the current flight departed from. */
  at: string;
  /** Flight currently being operated (off-blocks to on-blocks). */
  flightId: string | null;
  status: AircraftStatus;
  /** Active maintenance event while status is maintenance/aog. */
  maintId: string | null;
  /** Arrival on the AOC (status 'delivering' until then). */
  deliveredAt: Minute;
}

// ======================================================================
// Clients, offers and contracts (B1)
// ======================================================================

export type ClientKind = 'airline' | 'tourOperator' | 'government' | 'agency' | 'sports' | 'music' | 'corporate' | 'broker' | 'operator';

export interface Client {
  id: string;
  name: string;
  kind: ClientKind;
  country: string;
  base: string;
  /** 0–1 chance of paying on the due date; the rest pay late (governments). */
  payReliability: number;
  /** Extra days late when they do pay late: [min, max]. */
  lateDays: [number, number];
  /** How much a low "clean" reputation puts them off (0–1). */
  cleanSensitivity: number;
  /** Relationship −100…100; grows with good work, drops with failures. */
  relation: number;
}

export type Archetype =
  | 'seasonBase' | 'aogCover' | 'adhoc' | 'sports' | 'repatriation' | 'tourSeries' | 'troopRotation'
  // v0.7+
  | 'capacityLease' | 'hajj' | 'unRotation' | 'vip' | 'deportation' | 'evacuation' | 'humanitarian' | 'subcharterIn' | 'dryLeaseOut';

export type Product =
  /** ACMI / wet lease: rate per block hour against a monthly minimum. Client pays fuel, fees, hotels. */
  | { kind: 'wet'; ratePerBH: number; mghPerMonth: number; excessRate: number; cycleFee: number; positioningBillable: boolean }
  /** Full charter: one price for the whole programme; we pay fuel, fees, hotels. */
  | { kind: 'charter'; price: number; depositPct: number; balanceDaysBefore: number; fuelEscalation: boolean }
  /** Dry lease out: monthly rent plus reserves; the lessee flies it. */
  | { kind: 'dry'; rentPerMonth: number; reservesPerFH: number };

export interface Requirements {
  minSeats: number;
  maxSeats?: number;
  layout?: CabinLayout;
  body?: 'narrow' | 'wide';
  /** Acceptable rating families (empty/undefined = any). */
  families?: RatingFamily[];
  /** Longest revenue sector (nm) and shortest runway (m) on the programme — precomputed for fit checks. */
  longestSectorNm: number;
  minRunwayM: number;
  /** ETOPS minutes needed on the planned routing (0 = none). */
  etops: number;
  approvals: ApprovalId[];
  /** Extra cabin crew above the legal minimum the client asks for. */
  extraCabin: number;
  /** No fuel stops allowed (VIP optics). */
  noTechStops?: boolean;
}

/** A revenue leg the client wants flown (times are the client's scheduled departures). */
export interface LegTemplate {
  from: string;
  to: string;
  /** Scheduled departure (UTC minute). */
  dep: Minute;
  flightNo: string;
  pax?: number;
}

export type SchedulePattern =
  /** Explicit legs: ad hoc, sports, repatriation, tour series, troop rotation. */
  | { kind: 'legs'; legs: LegTemplate[] }
  /** Based at the client's station flying its rotations (season base, AOG cover). Flights roll out daily. */
  | {
      kind: 'base';
      base: string;
      /** Destinations rotated through (out-and-back from base). */
      dests: string[];
      /** First departure and last arrival window (UTC minutes). */
      from: Minute;
      to: Minute;
      /** Block hours per month the client plans (≈ MGH × 1.1). */
      targetBH: number;
      /** Local departure times (minutes after local midnight) of the daily waves. */
      waves: number[];
      /** Client flight-number prefix, e.g. 'NB'. */
      prefix: string;
      /** Contractual maintenance night every N days: the last wave is not flown (A-check window, DESIGN §5.1.6). */
      maintEvery: number;
    };

export interface Penalties {
  /** Cancel by us: [daysBeforeStart, fraction of contract value][], sorted by days descending. */
  cancelScale: [number, number][];
  /** Per departure delayed over 3 h, and per cancelled leg. */
  perDelay: number;
  perCancelledLeg: number;
}

export interface PaymentTerms {
  /** 'advance' = weekly in advance (commercial), 'arrears' = after the month, 'onCompletion' = charter balance. */
  basis: 'advance' | 'arrears' | 'onCompletion';
  /** Days after invoice when payment is due. */
  dueDays: number;
  depositPct: number;
}

export interface OfferEffects {
  reliable?: number;
  clean?: number;
  /** Crew morale delta for crews who fly it. */
  morale?: number;
}

export type OfferStatus = 'open' | 'countered' | 'accepted' | 'lost' | 'expired' | 'declined';

export interface ContractOffer {
  id: string;
  archetype: Archetype;
  clientId: string;
  /** Broker name when it came through a broker (commission applies). */
  broker?: string;
  title: string;
  blurb: string;
  product: Product;
  requirements: Requirements;
  pattern: SchedulePattern;
  start: Minute;
  end: Minute;
  created: Minute;
  expires: Minute;
  /** 'urgent' < 72 h lead, 'short' < 7 days. */
  urgency: 'normal' | 'short' | 'urgent';
  penalties: Penalties;
  payment: PaymentTerms;
  effects: OfferEffects;
  /** 0–1 risks shown as chips: late payment, disruption, politics, overflight/landing permit delay. */
  risk: { payment: number; disruption: number; politics: number; permit: number };
  /** Estimated revenue block hours and value at the asking price. */
  estBH: number;
  estValue: number;
  /** Hidden walk-away multiplier on the asking price (counters above it are refused). */
  floor: number;
  /** Player counter awaiting the client's reply. B1: aircraft chosen for it, and the client's answer once given. */
  counter?: { price: number; at: Minute; replyAt: Minute; aircraftIds?: string[]; result?: 'accepted' | 'refused' };
  status: OfferStatus;
  /** Map pin airport. */
  pin: string;
  /** B1: rival that won it (lost offers), and when the offer left the market (missed-list retention). */
  lostTo?: string;
  closedAt?: Minute;
  /** B1: one-line reason it fits the calendar ("fits CS-TQA's free week"), for the offer card. */
  hook?: string;
}

export type ContractStatus = 'signed' | 'active' | 'completed' | 'cancelled';

export interface MonthUse {
  /** Billable block minutes flown (revenue, tech-stop and billable positioning) and cycles. */
  blockMin: number;
  cycles: number;
  /** Cycles on sectors under 90 block minutes (short-cycle fee). */
  shortCycles: number;
}

export interface Contract {
  id: string;
  offerId: string;
  archetype: Archetype;
  clientId: string;
  broker?: string;
  title: string;
  product: Product;
  pattern: SchedulePattern;
  requirements: Requirements;
  penalties: Penalties;
  payment: PaymentTerms;
  effects: OfferEffects;
  aircraftIds: string[];
  start: Minute;
  end: Minute;
  signed: Minute;
  status: ContractStatus;
  /** Rolling schedule generation horizon for 'base' patterns. */
  generatedUntil: Minute;
  /** Usage per month for MGH billing. */
  use: Record<MonthKey, MonthUse>;
  billedMonths: MonthKey[];
  /** Colour index for the Gantt (0–7). */
  color: number;
  /** Charter balance invoice date (start − balanceDaysBefore); null once invoiced or for wet/dry. */
  balanceAt: Minute | null;
  /** B1: remaining charter instalments (balance per trip); the next one is due at balanceAt. */
  instalments?: { at: Minute; amount: number }[];
  /** B1: money invoiced so far, charter revenue recognised so far, planned revenue block minutes it accrues over. */
  invoiced?: number;
  accrued?: number;
  planRevMin?: number;
  /** B1: revenue legs flown and those on time (≤ 15 min late). */
  legsFlown?: number;
  legsOnTime?: number;
  /** B1: when we cancelled it. */
  cancelledAt?: Minute;
}

// ======================================================================
// Flights (B1 generates, B3 executes)
// ======================================================================

/**
 * revenue: client leg · positioning: empty leg to/from a contract (billable on wet leases) ·
 * ferry: non-revenue move (maintenance, delivery) · techstop: a revenue sector split by a fuel stop (billed as revenue) ·
 * deadhead: crew travelling as passengers on a commercial airline (aircraftId null).
 */
export type FlightKind = 'revenue' | 'positioning' | 'ferry' | 'techstop' | 'deadhead';
export type FlightStatus = 'scheduled' | 'enroute' | 'done' | 'cancelled';

export interface Flight {
  id: string;
  /** Flight number shown on the board: client number on wet leases, ours on charters. */
  no: string;
  aircraftId: string | null;
  contractId: string | null;
  kind: FlightKind;
  from: string;
  to: string;
  /** Scheduled off-blocks / on-blocks (UTC minutes). */
  std: Minute;
  sta: Minute;
  /** Scheduled block minutes (sta − std). */
  block: number;
  pax?: number;
  /** Crew on board (operating + augmenting); deadheading crew ride on 'deadhead' flights. */
  crewIds: string[];
  dutyId: string | null;
  status: FlightStatus;
  /** Actual off/on blocks once known. */
  atd?: Minute;
  ata?: Minute;
  /** Current departure delay estimate (minutes). */
  delay: number;
  delayReason?: string;
  /** Event version: bumped whenever times change so stale queue entries are ignored. */
  ev: number;
  /** Ticket cost for deadheads. */
  cost?: number;
  /** Actual on-blocks queued at departure (map interpolation target). */
  eta?: Minute;
  /** Rival id when the leg was sub-chartered (aircraftId null, still billed to our client). */
  operatedBy?: string;
  /** B3: original STD before ops delays (std/sta move with retimes); a crew-short decision was taken for it. */
  schedStd?: Minute;
  crewDecided?: boolean;
  /** B3: held at departure for crew (counted once in stats.uncovered); crew waits so far; when ops first held it. */
  crewHeld?: boolean;
  crewTries?: number;
  heldAt?: Minute;
}

// ======================================================================
// Crew (B2)
// ======================================================================

/** CPT captain · FO first officer · CRP cruise-relief pilot · CSD cabin service director (SCCM, widebody purser) ·
 *  SCC senior cabin crew (SCCM on narrowbodies, No. 2 on widebodies) · CC cabin crew. */
export type Role = 'CPT' | 'FO' | 'CRP' | 'CSD' | 'SCC' | 'CC';

export type CrewStatus = 'available' | 'onDuty' | 'resting' | 'off' | 'leave' | 'sick' | 'training' | 'joining';

/** One completed (or running) duty in the rolling log. */
export interface DutyLogEntry {
  start: Minute;
  end: Minute;
  /** Flight duty period minutes (positioning before operating counts, after does not). */
  fdp: number;
  /** Block minutes operated. */
  block: number;
  sectors: number;
  augmented: boolean;
  /** Early, late or night duty (counts towards the 4-disruptive ERRP extension). */
  disruptive: boolean;
}

export interface CrewMember {
  id: string;
  first: string;
  last: string;
  nationality: string;
  role: Role;
  /** Type-rating families held (cabin crew: at most 3). */
  ratings: RatingFamily[];
  languages: string[];
  base: string;
  /** Where they are now (or will be when the current travel ends). */
  loc: string;
  status: CrewStatus;
  /** Earliest next report (end of minimum rest). */
  restUntil: Minute;
  /** Rolling log, pruned to the last 28 days. */
  log: DutyLogEntry[];
  /** Calendar-year block minutes (reset 1 Jan). */
  blockYear: number;
  /** End of the last extended recovery rest (36 h incl. 2 local nights). */
  lastRecovery: Minute;
  /** Start of the current trip away from base (per diem, morale), null at base. */
  awaySince: Minute | null;
  morale: number;
  fatigue: number;
  /** Gross monthly salary (USD). */
  salary: number;
  hired: Minute;
  /** Commander's discretion uses this month. */
  discretion: number;
  /** Total flying hours (seniority; command upgrades). */
  totalHours: number;
  /** B2: unavailable windows (sick, leave, training, joining); pruned once past. */
  blocks?: { from: Minute; to: Minute; why: 'sick' | 'leave' | 'training' | 'joining' }[];
  /** B2: calendar year that blockYear counts. */
  blockYearOf?: number;
}

export interface CrewSlot {
  role: Role;
  crewId: string | null;
}

export type Legality = 'legal' | 'tight' | 'illegal';

/** One flight duty period: report → sectors → release. */
export interface Duty {
  id: string;
  pairingId: string;
  report: Minute;
  release: Minute;
  /** Operated flights in order (Flight ids). */
  flightIds: string[];
  /** Flights the crew rides as passengers: commercial 'deadhead' flights, or our own positioning legs. */
  deadheadIds: string[];
  sectors: number;
  fdp: number;
  maxFdp: number;
  /** Pilots above the minimum (0, 1 or 2). */
  augment: 0 | 1 | 2;
  /** Where the crew rests afterwards. */
  restAt: string;
  legality: Legality;
  ev: number;
  /** Sum of the operated flights' ev when the duty was last synced (cheap change detection). */
  flightsEv: number;
  /** B2: released and written to the crew logs. */
  done?: boolean;
  /** B2: commander's discretion granted on top of maxFdp (minutes). */
  discretion?: number;
}

/** A crew complement's trip: duties from base back to base (or a deployment at a client base). */
export interface Pairing {
  id: string;
  aircraftId: string | null;
  contractId: string | null;
  /** Set for one crew set's tour at a deployment (arrive → leave); null for base → base trips. */
  deploymentId: string | null;
  base: string;
  start: Minute;
  end: Minute;
  dutyIds: string[];
  slots: CrewSlot[];
  status: 'planned' | 'active' | 'done' | 'broken';
  legality: Legality;
  /** B2: deployment tour of crew set `set`, on station for duties reporting in [from, to). */
  tour?: { set: number; from: Minute; to: Minute };
}

/**
 * A crew station at a client base (wet season base, AOG cover). Crew sets are positioned in and out every
 * policies.rotationWeeks; each set's tour is a Pairing; days off inside the tour are spent at the hotel.
 */
export interface Deployment {
  id: string;
  contractId: string;
  aircraftId: string;
  base: string;
  start: Minute;
  end: Minute;
  /** Sets on station needed for the duty pattern (DESIGN §5.3). */
  setsOnStation: number;
  /** Tours (Pairing ids), in arrival order. */
  pairingIds: string[];
  /** B2: first tour change per set (staggered); later changes every rotationWeeks. */
  anchors?: Minute[];
}

export interface HireOrder {
  id: string;
  role: Role;
  family: RatingFamily;
  base: string;
  /** Crew member created at order time with status 'joining'. */
  crewId: string;
  ordered: Minute;
  ready: Minute;
  cost: number;
}

export type TrainingKind = 'typeRating' | 'command' | 'sccm' | 'conversion';

export interface TrainingItem {
  id: string;
  crewId: string;
  kind: TrainingKind;
  family: RatingFamily;
  start: Minute;
  end: Minute;
  cost: number;
}

// ======================================================================
// Maintenance (B3)
// ======================================================================

export type MaintKind = 'A' | 'C' | 'AOG' | 'line';

export interface MaintenanceEvent {
  id: string;
  aircraftId: string;
  kind: MaintKind;
  at: string;
  start: Minute;
  end: Minute;
  cost: number;
  status: 'planned' | 'inWork' | 'done' | 'cancelled';
  /** Planned by the player/auto-planner, or forced (AOG, overdue). */
  planned: boolean;
  cause?: string;
  ev: number;
  /** B3: ferry legs booked to reach the check; when it was booked. */
  ferryIds?: string[];
  booked?: Minute;
}

// ======================================================================
// Inbox (B3 owns events/decisions; any module may post messages via engine/messages.ts)
// ======================================================================

export type MessageCat = 'ops' | 'crew' | 'commercial' | 'tech' | 'finance' | 'company' | 'goal';

export interface Ref {
  kind: 'flight' | 'aircraft' | 'contract' | 'offer' | 'crew' | 'maint' | 'airport';
  id: string;
}

export interface Message {
  id: string;
  t: Minute;
  tone: 'info' | 'good' | 'warn' | 'bad';
  cat: MessageCat;
  title: string;
  body: string;
  read: boolean;
  ref?: Ref;
}

export interface DecisionOption {
  id: string;
  label: string;
  desc: string;
  tone?: 'good' | 'warn' | 'bad';
  /** Cost/benefit chips, e.g. '−$12K', 'Morale −3'. */
  chips?: string[];
}

export interface Decision {
  id: string;
  t: Minute;
  /** Resolver key (see ops/events.ts). */
  kind: string;
  title: string;
  body: string;
  options: DecisionOption[];
  /** Applied automatically at expiry. */
  defaultOption: string;
  expires: Minute;
  ref?: Ref;
  data?: Record<string, string | number | boolean>;
}

// ======================================================================
// Finance (ledger primitive in engine/ledger.ts; statements/receivables B3)
// ======================================================================

export type LedgerCat =
  | 'acmiRevenue' | 'charterRevenue' | 'otherRevenue'
  | 'fuel' | 'airportFees' | 'rent' | 'reserves' | 'salaries' | 'perDiem' | 'hotels' | 'deadhead' | 'maintenance' | 'checks'
  | 'insurance' | 'overhead' | 'training' | 'hiring' | 'penalties' | 'subcharter' | 'approvals' | 'interest' | 'capex' | 'assetSale';

export interface MonthStatement {
  month: MonthKey;
  /** Revenue positive, costs negative (accrual: revenue when invoiced). */
  lines: Partial<Record<LedgerCat, number>>;
  /** Block hours flown (revenue + positioning) in the month. */
  bh: number;
  cashStart: number;
  cashEnd: number;
  closed: boolean;
}

export interface Receivable {
  id: string;
  clientId: string;
  contractId: string | null;
  desc: string;
  amount: number;
  issued: Minute;
  due: Minute;
  /** When the client will actually pay (rolled at issue from its reliability; hidden from the UI). */
  payAt: Minute;
  paid: Minute | null;
  /** Revenue category it is booked under. */
  cat: LedgerCat;
  /** B3: overdue reminders sent (days overdue: 7, 30); sold to a factor. */
  nudged?: number;
  factored?: boolean;
}

export interface Finance {
  /** Accruing statement for the current month. */
  current: MonthStatement;
  history: MonthStatement[];
  receivables: Receivable[];
  /** B3 solvency: cash negative since; rescues taken; rescue refused; last low-cash warning. */
  negSince?: Minute | null;
  rescues?: number;
  refusedRescue?: boolean;
  lowCashAt?: Minute;
}

// ======================================================================
// Market, rivals, goals (B3)
// ======================================================================

export interface AircraftOffer {
  id: string;
  typeId: string;
  kind: 'dryLeaseIn' | 'buy';
  lessor: string;
  builtYear: number;
  cabin: Cabin;
  rentPerMonth: number;
  reservesPerFH: number;
  leaseMonths: number;
  price: number;
  deposit: number;
  /** Delivery lead time once signed (days). */
  leadDays: number;
  expires: Minute;
}

export interface Market {
  aircraft: AircraftOffer[];
  /** Fuel price USD per tonne. */
  fuelPrice: number;
  /** Demand index per segment (1 = normal). */
  narrowIndex: number;
  wideIndex: number;
  /** B3: guaranteed offers already made (narrowbody lease in month 1–2, old widebody by month 4–6). */
  gotNarrow?: boolean;
  gotWide?: boolean;
}

export interface Rival {
  id: string;
  name: string;
  country: string;
  base: string;
  fleet: { typeId: string; count: number }[];
  /** Price multiplier vs list (0.85–1.2) and service quality 0–1. */
  priceFactor: number;
  quality: number;
  personality: 'cheap' | 'premium' | 'rescue' | 'military' | 'steady';
}

export interface GoalState {
  id: string;
  done: Minute | null;
}

// ======================================================================
// Simulation queue (engine core)
// ======================================================================

export type SimEventType =
  | 'day' | 'month'
  | 'flight.dep' | 'flight.arr'
  | 'duty.report' | 'duty.release'
  | 'maint.start' | 'maint.end'
  | 'offer.spawn' | 'offer.expire' | 'offer.reply'
  | 'contract.start' | 'contract.end'
  | 'crew.join' | 'training.done'
  | 'payment'
  | 'aircraft.delivery' | 'lease.end'
  | 'approval.done'
  | 'decision.expire';

export interface SimEvent {
  t: Minute;
  /** Tie-breaker: insertion order (deterministic). */
  seq: number;
  type: SimEventType;
  /** Entity id the event is about ('' for day/month). */
  id: string;
  /** Entity version at scheduling time; handlers ignore the event if the entity's ev changed. */
  v: number;
}

// ======================================================================
// Root
// ======================================================================

export interface Stats {
  /** Lifetime billable block minutes and revenue legs. */
  blockMin: number;
  legs: number;
  onTime: number;
  delayed: number;
  cancelled: number;
  contractsDone: number;
  bestMonthProfit: number;
  /** B3: departures, AOGs, legs whose crew was missing/illegal at departure, legs flown with an illegal duty,
   *  decisions taken, augmented long-haul duties and ULR sectors flown, legs sub-chartered. */
  departures?: number;
  aogs?: number;
  uncovered?: number;
  illegalFlown?: number;
  decisions?: number;
  augmentedDuties?: number;
  ulrSectors?: number;
  subchartered?: number;
  /** B3: when recent player decisions were posted (last 7 days; pacing budget). */
  askedAt?: number[];
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  /** Id counter (see engine/entities.ts nextId). */
  seq: number;
  /** Current game time (integer minutes). */
  now: Minute;
  started: Minute;
  scenario: string;
  company: Company;
  fleet: Record<string, Aircraft>;
  crew: Record<string, CrewMember>;
  flights: Record<string, Flight>;
  duties: Record<string, Duty>;
  pairings: Record<string, Pairing>;
  deployments: Record<string, Deployment>;
  clients: Record<string, Client>;
  offers: Record<string, ContractOffer>;
  contracts: Record<string, Contract>;
  maintenance: Record<string, MaintenanceEvent>;
  hires: HireOrder[];
  training: TrainingItem[];
  /** Newest first. */
  messages: Message[];
  decisions: Decision[];
  finance: Finance;
  market: Market;
  rivals: Rival[];
  goals: GoalState[];
  stats: Stats;
  /** Binary min-heap ordered by (t, seq). */
  queue: SimEvent[];
  /** Bankruptcy (fail-forward later) or retirement. */
  gameOver: { t: Minute; reason: string } | null;
}

/** Result of a player action (store.act toasts the error or message). */
export type ActionResult<T = undefined> = { ok: true; msg?: string; data?: T } | { ok: false; error: string };
