// Game state for BLOCK HOURS. Everything here is plain JSON (saved with lz-string).
// Shared contract between the engine modules and the UI: see docs/acmi/DESIGN.md §2.
// Builders may ADD optional fields in their own domain section; renames/removals go through the architect.

import type { CabinLayout, RatingFamily } from '../../data/acmiTypes';
import type { LogoId } from '../../data/livery';

export type { LogoId };

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

export type StickerKind = 'code' | 'titles' | 'logo';
export type StickerSide = 'fuselage' | 'fin';

/** v0.5.1: one sticker on the airframe. Position is a centre point in the frame of its side, so one livery fits every type. */
export interface StickerPlacement {
  /** Unique within the livery: 'code', 'titles', 'logo', 'logo2'. UI-made, not an engine id. */
  id: string;
  kind: StickerKind;
  side: StickerSide;
  /** fin: x = chord fraction LE (0) → TE (1), y = root (0) → tip (1), bilinear on the fin quad.
   *  fuselage: x = fraction of L from the nose tip (0) to the tail-cone end (1), y = fraction of H from the crown (0) to the belly (1).
   *  Omitted = auto (today's anchor for the scheme / the type's title band). */
  x?: number;
  y?: number;
  /** × the auto-fit size (1 = fits its zone). Clamped 0.3–3; beyond the airframe it is clipped like a sticker. */
  scale: number;
  /** Degrees clockwise on screen, −45…45. Default 0. */
  rotation?: number;
}

export interface LiveryText {
  /** Omitted = the default text: company code / name (client livery: client designator / name). */
  text?: string;
  /** Omitted = auto contrast. */
  color?: string;
  weight?: 500 | 700;
}

export interface LiveryLogo {
  /** 'mono' = monogram of `text` (1–3 letters) in a roundel. */
  id: LogoId | 'mono';
  color: string;
  /** Second tone for two-tone logos; default = color. */
  color2?: string;
  text?: string;
}

export interface Livery {
  primary: string;
  secondary: string;
  tail: TailStyle;
  /** v0.5.1. Plain airframe: no scheme colour areas, grey engine accents. Stickers still draw. */
  plain?: boolean;
  code?: LiveryText;
  titles?: LiveryText;
  logo?: LiveryLogo;
  /** Absent = legacy: [code auto on the fin, titles auto on the fuselage]. Present = exactly these draw (≤ 6). */
  stickers?: StickerPlacement[];
}

/** v0.5.1: the player's livery choice for one aircraft (undefined = 'company'). */
export type LiveryRef = 'company' | 'white' | { custom: Livery };

// ======================================================================
// Company
// ======================================================================

export type ApprovalId =
  | 'etops120' | 'etops180' | 'etops240' | 'augmented' | 'ulr' | 'iosa' | 'dg'
  | 'areaAfrica' | 'areaAsia' | 'areaAmericas' | 'un' | 'defence' | 'vip' | 'hajj' | 'polar' | 'cabinCargo'
  /** v0.7 the Ladder: widebody operations (one approval covers every widebody family). */
  | 'widebody';

export interface PendingApproval {
  id: ApprovalId;
  started: Minute;
  done: Minute;
  cost: number;
  /** v0.7: authority findings (+30 d each, max 2). */
  findings?: number;
  /** v0.7: due but waiting for this requirement (re-checked daily). */
  waiting?: string;
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
  /** v0.7: when each approval was granted. load: ??= {}, held ones ← g.started. */
  approvalsAt?: Partial<Record<ApprovalId, Minute>>;
}

// ======================================================================
// Fleet
// ======================================================================

export type Ownership =
  | { kind: 'owned'; bookValue: number; /** v0.7 */ newBuild?: boolean }
  | {
      kind: 'dryLeaseIn'; lessor: string; rentPerMonth: number; reservesPerFH: number; leaseStart: Minute; leaseEnd: Minute; /** B3: refundable deposit paid at signing. */ deposit?: number;
      /** v0.7: redelivery airport (load ??= homeBase); cabin at delivery (load ??= current); new-build; 120-day notice given. */
      returnSite?: string; deliveredLayout?: CabinLayout; newBuild?: boolean; noticeGiven?: boolean;
    };

/** v0.7: handover abroad and the delivery ferry home. */
export interface DeliveryInfo {
  site: string;
  /** 'ex-LATAM, Santiago (SCL)' / 'Tarmac Aerosave, Tarbes (LDE)'. */
  where: string;
  handover: Minute;
  ferryIds: string[];
  /** Ferry held for crew since (parking charged daily). */
  waitingSince?: Minute;
  arrived?: Minute;
  /** 48 h no-pilots warning given. */
  warned?: boolean;
}

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
  /** v0.5.1: player's livery choice (undefined = 'company'). */
  livery?: LiveryRef;
  /** v0.5.1: contract whose client livery is on the aircraft (set when the paint-in ends, cleared when the strip ends). Overrides `livery`. */
  paintedFor?: string;
  /** v0.6: extra crew above the legal minimum (unset = company default). */
  crewExtra?: CrewExtra;
  /** v0.7: handover abroad and the delivery ferry (unset on v0.6 deliveries: handover at base, no ferry). */
  delivery?: DeliveryInfo;
  /** v0.7: lease return booked (ferry + return check). */
  returning?: { site: string; maintId: string; ferryIds: string[]; quote: number };
}

/** v0.6: crew above the legal minimum (per aircraft or contract): cabin 0–4, one spare pilot. */
export interface CrewExtra {
  cabin: number;
  pilot: 0 | 1;
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
  /** v0.7: accepted cabin layouts (supersedes `layout` when set); premium seats J + W. */
  layouts?: CabinLayout[];
  minPremium?: number;
  /** v0.6: client pays pct of price/rate when we fly ≥ n extra cabin crew. */
  extraCabinPaid?: { n: number; pct: number; /** v0.6: USD per extra cabin crew member per block hour behind pct. */ perBH?: number };
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
  counter?: {
    price: number; at: Minute; replyAt: Minute; aircraftIds?: string[];
    /** v0.5.2: 'halfway' = the client met us halfway (`offer`, now the price on the table). */
    result?: 'accepted' | 'refused' | 'halfway';
    /** v0.5.1: paint on (default) or off. */ paint?: boolean;
    /** v0.5.2: expiry minutes left when sent (the clock is paused while the counter is pending), and the client's halfway price. */
    left?: number; offer?: number;
  };
  status: OfferStatus;
  /** Map pin airport. */
  pin: string;
  /** B1: rival that won it (lost offers), and when the offer left the market (missed-list retention). */
  lostTo?: string;
  closedAt?: Minute;
  /** B1: one-line reason it fits the calendar ("fits CS-TQA's free week"), for the offer card. */
  hook?: string;
  /** v0.5.1: the client wants the aircraft in its livery for the contract. */
  paint?: PaintTerms;
}

/** v0.5.1 client paint. decals = plain white body + client titles + fin logo. */
export type PaintKind = 'full' | 'decals';

export interface PaintTerms {
  kind: PaintKind;
  /** true: a condition of the deal. false: optional; turning it off costs `declinePct` of the rate/price. */
  required: boolean;
  /** Optional: 0.02–0.05 off when declined. Required: the cut the client asks on a counter without paint (0.05–0.08). */
  declinePct: number;
  /** Share of paint-in + strip the client reimburses (1, 0.5 or 0). */
  clientShare: number;
  /** Rate/price bonus already in the asking price when the client pays nothing (0 or 0.04). */
  bonusPct?: number;
  /** Per aircraft, USD, quoted at generation (stored, never re-rolled). */
  cost: number;
  stripCost: number;
  days: number;
  stripDays: number;
  livery: Livery;
}

export type ContractStatus = 'signed' | 'active' | 'completed' | 'cancelled';

export interface MonthUse {
  /** Billable block minutes flown (revenue, tech-stop and billable positioning) and cycles. */
  blockMin: number;
  cycles: number;
  /** Cycles on sectors under 90 block minutes (short-cycle fee). */
  shortCycles: number;
  /** Block minutes of revenue legs we cancelled ourselves (non-performance: off the month's MGH). */
  lostMin?: number;
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
  /** Charter revenue block minutes flown or sub-chartered (earned share; absent in old saves). */
  revMinDone?: number;
  /** B1: revenue legs flown and those on time (≤ 15 min late). */
  legsFlown?: number;
  legsOnTime?: number;
  /** B1: when we cancelled it. */
  cancelledAt?: Minute;
  /** v0.5.1: client paint agreed (accepted) or declined; paint-in / strip maintenance ids per aircraft. */
  paint?: PaintTerms & { accepted: boolean; inMx?: Record<string, string>; outMx?: Record<string, string>; warned?: boolean };
  /** v0.6: extra crew for this contract (overrides the aircraft's); locked ≥ requirements.extraCabinPaid.n when paid. */
  crewExtra?: CrewExtra;
  /** v0.6: service score accumulator over revenue legs (morale + extra crew). */
  service?: { sum: number; n: number };
  /** v0.6: the client pays for extra cabin crew (accepted at signing). */
  extraPaid?: boolean;
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
  /** Crew riding our own positioning or ferry leg as passengers (positioning to their next duty). */
  riders?: string[];
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
  /** B3: lateness the player accepted with delayFlight (minutes); recovery's lateness cap counts on top of it. */
  lateOk?: number;
  /** B2: the crew-shortage warning was given for this flight (once; saved so a reload does not repeat it). */
  crewWarned?: boolean;
  /** v0.7: why an empty ferry flies (labels, map, ticket purpose). */
  purpose?: 'delivery' | 'return' | 'refit';
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

/** v0.6: morale drivers (crew card "why"). */
export type MoraleDriver = 'policy' | 'hotel' | 'tour' | 'offAway' | 'workload' | 'lateChange' | 'discretion' | 'mission' | 'extraCrew' | 'career' | 'pay' | 'recognition';

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
  /** v0.6: resigned; keeps flying until `leaves` (then removed from g.crew). */
  notice?: { given: Minute; leaves: Minute };
  /** v0.6: decayed 30-day morale contributions by driver (UI "why"). */
  moraleWhy?: Partial<Record<MoraleDriver, number>>;
  /** v0.6: company-paid pilot conversion bond (resignation × bondFactor until then). */
  bondUntil?: Minute;
  /** v0.6: daily morale samples (newest last, max 15) for the 14-day trend arrow. */
  moraleHist?: number[];
  /** v0.6: last late-notice roster change hit (at most one a day). */
  lateAt?: Minute;
}

export interface CrewSlot {
  role: Role;
  crewId: string | null;
  /** Manual assignment (roster view): the rolling re-plan keeps this crew member even when flagged illegal. */
  locked?: boolean;
  /** Extra crew member above the legal complement (manual; dropped when unassigned). */
  extra?: boolean;
  /** v0.6: seat above the legal minimum (crew-extra settings): optional, never blocks departure. */
  above?: boolean;
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
  /** B2: with legality 'illegal' from a crew member's limits, the report of the first duty they can't fly. */
  illegalFrom?: Minute;
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
  /** B2: sets from the initial sizing (later growth is capped at one more). */
  sized?: number;
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
  /** v0.6: conversion class this course belongs to. */
  classId?: string;
}

/** v0.6: a conversion class (bulk type rating): up to BAL.conv.classMax crew of one group and course. */
export interface TrainingClass {
  id: string;
  /** 'A330-P1' / 'A330-C2'. */
  no: string;
  family: RatingFamily;
  group: 'pilot' | 'cabin';
  course: 'full' | 'ccq';
  start: Minute;
  end: Minute;
  crewIds: string[];
  costPerHead: number;
  status: 'planned' | 'running' | 'done' | 'cancelled';
  /** Cabin crew at 3 types: the rating each gives up at completion. */
  drop?: Record<string, RatingFamily>;
}

// ======================================================================
// Maintenance (B3)
// ======================================================================

export type MaintKind = 'A' | 'C' | 'AOG' | 'line' | 'paint' | 'refit' | 'return';

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
  /** B3: ferry legs booked to reach the check; when it was booked; the start it was booked for (later shifts move start). */
  ferryIds?: string[];
  booked?: Minute;
  bookedStart?: Minute;
  /** v0.5.1: client paint-in or strip at a paint shop. */
  paint?: { phase: 'in' | 'out'; contractId: string };
  /** v0.7 cabin refit: the cabin fitted at the end. */
  refit?: { cabin: Cabin };
  /** v0.7 lease return check: the aircraft leaves the fleet at the end. */
  leaseReturn?: boolean;
}

// ======================================================================
// Inbox (B3 owns events/decisions; any module may post messages via engine/messages.ts)
// ======================================================================

export type MessageCat = 'ops' | 'crew' | 'commercial' | 'tech' | 'finance' | 'company' | 'goal';

export interface Ref {
  /** v0.7 'market': an aircraft market offer. */
  kind: 'flight' | 'aircraft' | 'contract' | 'offer' | 'crew' | 'maint' | 'airport' | 'market';
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
  /** v0.7: market alerts (UI may hide them) and ladder steps (celebration). */
  topic?: 'market' | 'ladder';
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
  | 'insurance' | 'overhead' | 'training' | 'hiring' | 'penalties' | 'subcharter' | 'approvals' | 'interest' | 'capex' | 'assetSale'
  /** v0.5.1: client paint-in and strip. */
  | 'paint'
  /** v0.7: cabin refits; lease return costs. */
  | 'refit' | 'leaseReturn';

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
  /** v0.7: handover airport (load ??= homeBase), its text, ex-operator, new-build slot, when posted. */
  site?: string;
  where?: string;
  exOperator?: string;
  newBuild?: boolean;
  created?: Minute;
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
  /** v0.7: the post-filing widebody offer was made. */
  gotWideFiled?: boolean;
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
  /** Duties that left with a crew member over a limit (rest, recovery, location, status…; counted at the first leg). */
  illegalCrewFlown?: number;
  decisions?: number;
  augmentedDuties?: number;
  ulrSectors?: number;
  subchartered?: number;
  /** B3: when recent player decisions were posted (last 7 days; pacing budget). */
  askedAt?: number[];
  /** B3: landing-permit risk of signed trips by contract id (offers are pruned after signing); dropped once rolled. */
  permits?: Record<string, number>;
  /** v0.6: crew who left after resigning; conversion classes completed. */
  resigned?: number;
  conversions?: number;
  /** v0.6: weekly company morale averages, newest last, max 12. */
  moraleWeeks?: number[];
  /** v0.6: last quiet-week gap-fit offer. */
  lastGapOfferAt?: Minute;
  /** v0.6: low-morale message given (rearmed above 55). */
  moraleLowWarned?: boolean;
  /** v0.6: rated pilot hires of the last 30 days [ordered, 'family:role', count] (the rated market's pool). */
  ratedHires?: [Minute, string, number][];
  /** v0.6: required seats an on-board spare took over this month (reset by the monthly morale line). */
  sparesCovered?: number;
  /** v0.7: illegal-crew and AOG incidents (pruned after 365 days; the Ladder's clean record). */
  incidents?: [Minute, 'illegalCrew' | 'aog'][];
  /** v0.7: deliveries, days delivery ferries waited for pilots, refits, lease returns and extensions, authority findings. */
  deliveries?: number;
  deliveryWaitDays?: number;
  refits?: number;
  leaseReturns?: number;
  leaseExtensions?: number;
  findings?: number;
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
  /** v0.6: conversion classes. load: ??= {} */
  classes?: Record<string, TrainingClass>;
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
