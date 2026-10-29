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

/** v0.10 a fuselage stripe (cheatline): multiplied over the white art like every livery colour. */
export interface LiveryStripe {
  color: string;
  /** Centre height: share of the fuselage from the crown (0) to the belly (1). Ignored with `windows`. */
  y: number;
  /** Thickness: share of the fuselage height (0.02–0.3). */
  h: number;
  /** Follows the type's window line (centred on the windows) instead of `y`. */
  windows?: boolean;
  /** Sweeps up the tail cone into the fin. */
  sweep?: boolean;
}

/**
 * v0.10 body paint: every field optional, absent = the white fuselage and today's tail-coloured engines. The fin keeps
 * `primary` / `secondary`; the fuselage colours are independent of them.
 */
export interface LiveryBody {
  /** Whole fuselage. */
  color?: string;
  /** Belly below a split line: height as a share of the fuselage (crown 0 → belly 1), tilt −1…1 (+ = higher at the nose).
   *  v0.11 `windows`: the split sits just below the type's window line instead of `split` (every type its own);
   *  `line`: a thin accent line along the split (thickness as a share of the fuselage height, 0.005–0.06). */
  belly?: { color: string; split: number; tilt: number; windows?: boolean; line?: { color: string; h: number } };
  /** 0–3 stripes, drawn over the body and belly colours. */
  stripes?: LiveryStripe[];
  /** Nose and cockpit area. */
  nose?: string;
  /** Engines' own colour (absent: the tail colour, as before v0.10). */
  engines?: string;
  /** Ring on the engine intake lips (absent: the bare metal lip as drawn). */
  lip?: string;
  /** v0.11 a band under the cockpit from the nose tip aft to about the first door, below the belly split line, with an
   *  optional thin accent line under it. */
  noseBand?: { color: string; accent?: string };
  /** v0.11 a thin stripe across the fin a little above its root. */
  finRoot?: string;
  /** v0.11 bands across the fin (t root 0 → tip 1), over the tail scheme: national colours, a mid-fin band. */
  finBands?: { color: string; t0: number; t1: number }[];
  /** v0.11 the tail colour wrapped onto the rear fuselage under the fin, its front edge sweeping down and aft. */
  tailWrap?: string;
  /** v0.11 vertical stripes over the fuselage and the fin, alternating with the paint under them (w: share of the
   *  length). */
  vstripes?: { color: string; w: number };
  /** v0.11 the livery's logo, small, on each engine cowl. */
  engineLogo?: boolean;
  /** v0.11 the livery's logo, small, on the forward fuselage under the cockpit (ahead of door 1). */
  noseLogo?: boolean;
}

/** v0.11 the registration painted small on the rear fuselage (on by default, with the registry state's flag). */
export interface LiveryReg {
  hide?: boolean;
  noFlag?: boolean;
  /** On the lower fin instead of the rear fuselage. */
  at?: 'fin';
  /** The fleet number (the registration's last letters or digits) at the top of the fin. */
  fleet?: boolean;
  /** v0.10.2 the aircraft's name (when it has one) not painted under the cockpit windows. */
  noName?: boolean;
  /** Omitted = auto ink. */
  color?: string;
}

export interface Livery {
  primary: string;
  secondary: string;
  tail: TailStyle;
  /** v0.10 fuselage, nose and engine colours (absent = white fuselage as drawn). */
  body?: LiveryBody;
  /** v0.5.1. Plain airframe: no scheme colour areas, grey engine accents. Stickers still draw. */
  plain?: boolean;
  code?: LiveryText;
  titles?: LiveryText;
  logo?: LiveryLogo;
  /** v0.11 the registration on the rear fuselage. */
  reg?: LiveryReg;
  /** v0.11 the aircraft model ("BOEING 777-300ER") painted small: by the registration (default; 'rear' the same), under
   *  the forward windows, or not at all. */
  model?: 'rear' | 'forward' | 'off';
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
  /** v0.10.2 the ETOPS maintenance programme (a one-off CAMO set-up the ETOPS approvals need): started, ready, paid; `held` once done. Older saves: not set up. */
  etopsMx?: { started: Minute; done: Minute; cost: number; held?: true };
  policies: Policies;
  departments: Department[];
  /** Next numeric flight number for own-designator flights. */
  nextFlightNo: number;
  /** v0.7: when each approval was granted. load: ??= {}, held ones ← g.started. */
  approvalsAt?: Partial<Record<ApprovalId, Minute>>;
  /** v0.8 company standing: 0 Newcomer · 1 Established · 2 Respected. load: ??= standingFor(g). */
  standing?: 0 | 1 | 2;
}

// ======================================================================
// Fleet
// ======================================================================

export type Ownership =
  | { kind: 'owned'; bookValue: number; /** v0.7 */ newBuild?: boolean; /** v0.7.2 bought on the market: when, price and index (the sale cap in the first year). */ boughtAt?: Minute; boughtPrice?: number; boughtIndex?: number }
  | {
      kind: 'dryLeaseIn'; lessor: string; rentPerMonth: number; reservesPerFH: number; leaseStart: Minute; leaseEnd: Minute; /** B3: refundable deposit paid at signing. */ deposit?: number;
      /** v0.7: redelivery airport (load ??= homeBase); cabin at delivery (load ??= current); new-build; 120-day notice given. */
      returnSite?: string; deliveredLayout?: CabinLayout; newBuild?: boolean; noticeGiven?: boolean;
      /** v0.7: the market index the rent was set at (absent = 1); extensions move rent by the index since. */ index?: number;
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
  /** v0.10 airframe variant where the art shows one (engines, door layout; src/data/variants.ts); unset for other types. */
  variant?: string;
  /** v0.5.1: contract whose client livery is on the aircraft (set when the paint-in ends, cleared when the strip ends). Overrides `livery`. */
  paintedFor?: string;
  /** v0.6: extra crew above the legal minimum (unset = company default). */
  crewExtra?: CrewExtra;
  /** v0.7: handover abroad and the delivery ferry (unset on v0.6 deliveries: handover at base, no ferry). */
  delivery?: DeliveryInfo;
  /** v0.7: lease return booked (ferry + return check). */
  returning?: { site: string; maintId: string; ferryIds: string[]; quote: number; /** v0.7.2 early-return fee (posted when the return check starts). */ earlyFee?: number };
  /** @deprecated v0.7.3: read `rest` (kept for the migration). v0.7.2 bunks and crew rest seats. */
  crewRest?: { bunks: boolean; seats: number };
  /**
   * v0.7.3 pilots' and cabin crew's in-flight rest facilities. load: ??= migrateRest(ac). v0.7.4: only what is FITTED
   * (bunks, crew rest recliners); the curtained business / economy seats of the current cabin are always there on top
   * (restPlan.restOf / effectiveRest).
   */
  rest?: AcRest;
  /** v0.7.4 the rest model the facilities are stored in (2 = fitted only, bunks paired; set by the load migration). */
  restV?: 2;
  /** v0.7.2 daily block minutes [dayIndex, min], last 90 days. */
  bhDays?: [number, number][];
  /** v0.7.2 day index bhDays tracking began (game start or the first load of an older save). load: ??= today */
  bhSince?: number;
  /** v0.7.2 an agreed sale (closes with 'aircraft.sale'). */
  sale?: { buyer: string; price: number; agreed: Minute; closes: Minute; ferryIds?: string[] };
}

/** v0.7.3 kind of in-flight rest facility (UPDATE-0.7.3.md §2.1). v0.7.4 'ySeats': curtained economy seats (every aircraft). */
export type RestKind = 'fcrc' | 'ccrc' | 'ldmcr' | 'jSeats' | 'recliners' | 'ySeats';
/** v0.7.3 one in-flight rest facility (CS FTL.1.205(c)): class, kind and how many crew can rest in it at once. */
export interface RestFacility { cls: 1 | 2 | 3; kind: RestKind; places: number }
/** v0.7.3 pilots' (fc) and cabin crew's (cc) facilities; null = none. Both may be the same seats (jSeats / recliners). */
export interface AcRest { fc: RestFacility | null; cc: RestFacility | null }
/** v0.7.3 crew rest refits (ops/cabin.ts). */
export type RestRefitId = 'curtainJ' | 'recliners' | 'removeRecliners' | 'ldmcr' | 'fcrc' | 'overhead';

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
  /** v0.7.2 last offer title (no repeats). */
  lastTitle?: string;
  /** v0.8 relationship level (stored with hysteresis). load: ??= levelFor(g, c) */
  level?: ClientLevel;
  /** v0.8 contracts completed for them; first and last job (completion). load: from contracts */
  jobs?: number;
  firstJob?: Minute | null;
  lastJob?: Minute | null;
  /** v0.8 last 8 relation changes: [time, delta, plain reason]. load: ??= [] */
  log?: [Minute, number, string][];
  /** v0.8 small delays forgiven this month: [month, count]. */
  forgiven?: [MonthKey, number];
  /** v0.8 this client is a rival operator (sub-charter in). */
  rivalId?: string;
}

/** v0.8 client relationship level (contracts/relations.ts). */
export type ClientLevel = 'unhappy' | 'new' | 'known' | 'trusted' | 'partner';

export type Archetype =
  | 'seasonBase' | 'aogCover' | 'adhoc' | 'sports' | 'repatriation' | 'tourSeries' | 'troopRotation'
  // v0.7+
  | 'capacityLease' | 'hajj' | 'unRotation' | 'vip' | 'deportation' | 'evacuation' | 'humanitarian' | 'subcharterIn' | 'dryLeaseOut'
  // v0.8
  | 'medical' | 'musicTour' | 'antarctic';

export type Product =
  /** ACMI / wet lease: rate per block hour against a monthly minimum. Client pays fuel, fees, hotels. */
  | { kind: 'wet'; ratePerBH: number; mghPerMonth: number; excessRate: number; cycleFee: number; positioningBillable: boolean }
  /** Full charter: one price for the whole programme; we pay fuel, fees, hotels. */
  | { kind: 'charter'; price: number; depositPct: number; balanceDaysBefore: number; fuelEscalation: boolean; /** v0.9 jumbo loads: fuel billed after flying at the actual burn (not in `price`). */ fuelAtCost?: true }
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
  /** v0.8 mixed crew: the client provides n of `of` cabin crew; leads = its SCCM is the senior (our purser stays home). */
  clientCabin?: { n: number; of: number; leads: boolean };
  /** v0.8 no fuel at the far end: the range check uses 2 × the sector (Antarctica). */
  roundTrip?: boolean;
  /** v0.8 medical: stretchers on board (6 seats each). */
  stretchers?: number;
  /** v0.8 presidential: a spare pilot on every duty. */
  extraPilot?: 1;
  /** v0.8 presidential standards: delays over 30 min cost perDelay × 3 and relation. */
  standards?: 'vip';
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
  /** v0.8 a rival's hidden timed bid (offers.ts finalize; 'rival.bid'): who, when, its price factor and why it wins. */
  rivalBid?: { rivalId: string; at: Minute; factor: number; why: string };
  /** v0.8 a Trusted/Partner client asked us first (+48 h, no rival bid). */
  firstRefusal?: boolean;
  /** v0.10.2 urgent and high-paying: it came as a phone call (contracts/call.ts). */
  call?: true;
  /** v0.8 repeat business: the contract it repeats. */
  repeatOf?: string;
  /** v0.8 the player opened or countered it (markOfferSeen): a rival win is announced. */
  seen?: boolean;
  /** v0.8 relationship-level and company-standing rate parts in the price (0.08 = +8 %). */
  levelPct?: number;
  standingPct?: number;
  /** v0.8 why a rival took it (plain text). */
  lostWhy?: string;
  /** v0.8 the world event that created it. */
  eventId?: string;
  /** v0.8 dry lease out: the aircraft it was offered for (gap-fit). */
  dryFor?: string;
  /** v0.8 billing terms inside [start, end) (Hajj phases): MGH only over these. */
  terms?: [Minute, Minute][];
  /** v0.8 dry lease out terms: the lessee's base, expected FH a month, deposit, lessor consent fee (leased-in), their paint, months. */
  dry?: { site: string; fhPerMonth: number; deposit: number; consent: number; paint?: 'full' | 'decals'; months: number };
  /** v0.7.4: the client wants a cabin layout for the contract (a quick reconfiguration at their expense). */
  cabin?: CabinTerms;
  /** v0.9 crew change at a fuel stop (UPDATE-0.9.md §W): the stops (one per slipping sector, airport codes) and the priced-in cost. */
  slip?: { at: string[]; cost: number };
  /** v0.9 jumbo load (§Y.2): 420+ passengers, all economy. */
  jumbo?: boolean;
}

/**
 * v0.7.4 a client cabin request ('client wants a two-class cabin for this contract'): a quick reconfiguration (about
 * 48 h at our hangar) before the first departure, paid by the client in full or half, optionally put back after.
 */
export interface CabinTerms {
  layout: CabinLayout;
  /** true: a condition of the deal; false: optional, `declinePct` off the rate/price without it. */
  required: boolean;
  declinePct: number;
  /** Share of the reconfiguration (and the change back) the client pays: 1 or 0.5. */
  clientShare: number;
  /** Quoted per aircraft on the offer's reference type (the real cost follows the aircraft's type). */
  cost: number;
  days: number;
  /** Put back to the aircraft's own cabin after the contract (at the same share). */
  revert: boolean;
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
  /** v0.8 revenue legs flown this month and those on time (≤ 15 min): the month's relation move. */
  legs?: number;
  onTime?: number;
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
  /** v0.7.4: the client's cabin request; per aircraft the cabin it had (`from`, for the change back) and the bookings. */
  cabin?: CabinTerms & { accepted: boolean; from?: Record<string, string>; inMx?: Record<string, string>; outMx?: Record<string, string>; warned?: boolean };
  /** v0.6: extra crew for this contract (overrides the aircraft's); locked ≥ requirements.extraCabinPaid.n when paid. */
  crewExtra?: CrewExtra;
  /** v0.6: service score accumulator over revenue legs (morale + extra crew). */
  service?: { sum: number; n: number };
  /** v0.6: the client pays for extra cabin crew (accepted at signing). */
  extraPaid?: boolean;
  /** v0.7.2 std of legs handed to rivals (90-day reliability cost). */
  subLegs?: Minute[];
  /** v0.8 dry lease out (ops/dryLease.ts). */
  dry?: DryLeaseState;
  /** v0.8 billing terms inside [start, end) (Hajj phases): MGH only over these. */
  terms?: [Minute, Minute][];
  /** v0.8 the world event that created it; repeat-offer chance rolled. */
  eventId?: string;
  repeatRolled?: boolean;
  /** v0.8 late legs that cost relation this month [month, n] (cap), and the deportation clean hit so far. */
  lateHits?: [MonthKey, number];
  cleanHit?: number;
  /** v0.9 round 4: the analyst's margin estimate at signing (shown %, the planner's own %); judged when the contract ends. */
  analyst?: { name: string; pct: number; est: number };
}

/** v0.8 a dry lease out: delivery ferry, the lease at the lessee's base, the return ferry. */
export interface DryLeaseState {
  site: string;
  fhPerMonth: number;
  deposit: number;
  outIds: string[];
  backIds: string[];
  leasedAt?: Minute;
  returnedAt?: Minute;
  /** Flight hours the lessee flew on our airframe. */
  fh: number;
  /** Days late (holdover). */
  late?: number;
  damage?: { cost: number; days: number; maintId?: string; what?: string };
  /** Reserves FH invoiced so far; the month rent last invoiced. */
  fhBilled?: number;
  rentMonth?: MonthKey;
  /** The scheduled end of the lease (before any late return). */
  leaseEnd?: Minute;
  /** Lessor consent fee paid (leased-in airframe). */
  consent?: number;
  /** The lessee flies it in its colours. */
  paint?: 'full' | 'decals';
  /** v0.8 we recalled it early (cancel after delivery): when. */
  recalled?: Minute;
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
  purpose?: 'delivery' | 'return' | 'refit' | /** v0.7.2 */ 'check' | 'sale' | /** v0.8 dry lease ferries */ 'lease';
  /** v0.7.1 crew-shortage ladder stage reached (amber ≤ 48 h, red ≤ 12 h); load: crewWarned → 'amber'. */
  crewAlert?: 'amber' | 'red';
  /** v0.7.1 a chartered business jet carrying our crew (kind 'deadhead'). */
  charter?: { cls: JetClass; model: string; operator: string; reg: string };
  /** v0.8 held by a closed airport (world event id). */
  closedBy?: string;
  /** v0.8 rerouted around a closed zone: extra minutes (set once). */
  detour?: number;
  /** v0.8 war-risk cover paid for this landing ($). */
  warRisk?: number;
  /** v0.8 insurers withdrew war-risk cover: asked (the decision is open), or 'wait' (asked again in a day). */
  uninsured?: 'asked' | 'wait' | 'ok';
  /** v0.10.2 a technical cause hit this leg (a technical delay, the aircraft AOG or in an overrunning check, grounded): technical dispatch reliability. */
  tech?: true;
  /** v0.11 Operations: diverted en route (ops/disrupt.ts): the planned destination, when and why it turned, the eta it had. */
  div?: { to0: string; at: Minute; eta0: Minute; cause: DisruptCause };
  /** v0.11 the leg that carries on to the planned destination after a diversion (its id on the diverted leg, and back). */
  contOf?: string;
  /** v0.11 a disruption already rolled or decided for this leg (one card per leg at most). */
  ops?: DisruptKind;
  /** v0.11 one cabin crew short under ORO.CC.100 (unforeseen: fewer passengers, a report to the authority). */
  reducedCabin?: number;
}

/** v0.11 the live disruption cards (ops/disrupt.ts). */
export type DisruptKind = 'ctot' | 'diversion' | 'medical' | 'birdStrike' | 'sickAway' | 'curfew' | 'turnaround';
export type DisruptCause = 'weather' | 'medical' | 'technical';

/** v0.7.1 private-jet charter classes (data/jets.ts). */
export type JetClass = 'light' | 'midsize' | 'heavy';

/** v0.7.1 Crew Control fixes (crew/control.ts). */
export type CrewFix = 'autoFix' | 'deadhead' | 'delay' | 'jet' | 'callIn' | 'discretion' | 'swap' | 'subcharter' | 'cancel';

/** v0.7.1 every kind of problem a ProblemCard can be about (engine/problems). */
export type ProblemKind =
  | 'crewShort' | 'crewIllegal' | 'crewTight' | 'crewReach' | 'crewRest' | 'crewFdp' | 'crewSick' | 'crewResigned'
  | 'aog' | 'checkDue' | 'checkOverdue' | 'checkClash' | 'checkNoSlot' | 'grounded'
  | 'offerFit' | 'counterExpiry' | 'changeRequest' | 'penalty' | 'contractCancelled'
  | 'cashLow' | 'invoiceOverdue' | 'lossMonth' | 'leaseDue' | 'goalMiss'
  /** v0.9 round 4 (§S): cash below zero, the day it happens. */
  | 'cashNegative'
  | 'deliveryWait' | 'ferryUncrewed' | 'refit' | 'leaseReturn'
  /** v0.11 a market offer we may not ferry home (ETOPS): told before signing, never posted. */
  | 'noFerry'
  /** v0.7.2 */
  | 'restSeats' | 'captainAsFo' | 'sale'
  /** v0.7.3 */
  | 'restFacility' | 'restTooShort' | 'cabinRest'
  /** v0.8 */
  | 'clientUnhappy' | 'lostToRival' | 'airspaceClosed' | 'uninsurable' | 'leaseLate' | 'leaseDamage' | 'dryLeaseInfo'
  /** v0.9 crew out of hours (a named crew member at a legal limit). */
  | 'crewHours'
  /** v0.11 Operations: a live disruption (its decision), a ramp inspection finding, an authority audit finding. */
  | 'disruption' | 'rampFinding' | 'auditFinding'
  /** Peak-staffing round: a busy month ahead short of crew (crew/forecast.ts). */
  | 'crewPeak';

/** v0.7.1 what a card is about: the entity (as a message Ref) plus the kind. */
export interface ProblemRef { kind: ProblemKind; ref: Ref }

// ======================================================================
// Crew (B2)
// ======================================================================

/** CPT captain · FO first officer · CRP cruise-relief pilot · PUR purser (the senior cabin crew member, SCCM) · CC cabin crew.
 *  v0.7.2: CSD and SCC merged into PUR (migrated in the crew module's load). */
export type Role = 'CPT' | 'FO' | 'CRP' | 'PUR' | 'CC';

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
  /** v0.7.3 planned extension (CS FTL.1.205(b)); early start / late finish / night duty (CS FTL.1.235(a)). */
  ext?: true;
  /**
   * BLU1396 round: the ORO.FTL.205(d) rest option this crew member took for the extension: 'split' = +2 h before and
   * +2 h after, 'after' = +4 h after (absent on older entries: +4 h after, as they were rested).
   */
  extRest?: 'split' | 'after';
  early?: boolean;
  late?: boolean;
  night?: boolean;
}

/** v0.6: morale drivers (crew card "why"). */
export type MoraleDriver = 'policy' | 'hotel' | 'tour' | 'offAway' | 'workload' | 'lateChange' | 'discretion' | 'mission' | 'extraCrew' | 'career' | 'pay' | 'recognition'
  /** v0.9 long standby runs; days off in the month (and a published day off taken). */
  | 'standby' | 'daysOff';

/** v0.9 standby kinds (UPDATE-0.9.md §R.3): home (SBY), hotel at a station away from base, airport (ASBY), reserve (RES). */
export type StandbyKind = 'home' | 'hotel' | 'airport' | 'reserve';

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
  blocks?: { from: Minute; to: Minute; why: 'sick' | 'leave' | 'training' | 'joining'; /** v0.9 planned annual leave. */ annual?: true }[];
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
  /** v0.7.2 reports flown in an FO/CRP seat as a captain (30 days). */
  asFoAt?: Minute[];
  /** v0.7.2 block minutes per month, last 12 (1,000 h / 12 months). */
  blockMonths?: Record<MonthKey, number>;
  /** v0.7.3 recovery rests holding 2 whole local days, per month (ORO.FTL.235(d)). */
  twoDays?: Record<MonthKey, number>;
  /** v0.7.3 current rotation away (time zones, CS FTL.1.235(b)): first report, max zone difference, direction. */
  rot?: { start: Minute; maxTz: number; dir: -1 | 0 | 1 };
  /** v0.7.3 last return from a rotation ≥ 4 h away: local nights needed at base. */
  tzBack?: { back: Minute; nights: number; dir: -1 | 1 };
  /** v0.7.3 home standby windows (next days; CS FTL.1.225(b)). */
  standby?: {
    from: Minute; to: Minute; calledAt?: Minute;
    /** v0.9 kind (absent = home), station (absent = base), early/late shift of a home window. */
    kind?: StandbyKind; at?: string; shift?: 'E' | 'L';
  }[];
  /** v0.9 base-local day indices rostered OFF (crew/dayPlan.ts), ascending; pruned 40 days back. */
  off?: number[];
  /** v0.9 days off counted at each month end (the last 13: the 96-a-year check). */
  offMonths?: Record<MonthKey, number>;
  /** v0.9 round 4: leave and sick days of each closed month (days free of duty too: the 96 a year), the last 13 kept. */
  freeMonths?: Record<MonthKey, number>;
  /** v0.9 last calendar year whose annual leave is planned. */
  leaveYear?: number;
  /** v0.9 round 3: when crew control last asked them to swap a published day off (one ask in 14 days). */
  offSwapAt?: Minute;
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
  /** v0.9 crew out of hours: who was taken off this seat for a legal limit, which, by how much (min) and when; cleared on a legal refill. */
  ooh?: { crewId: string; limit: OohLimit; over: number; at: Minute };
  /** v0.9 round 4 (§Y.1): a replacement who joined after the duty reported: their own report (a fresh day). Cleared with the seat. */
  from?: Minute;
}

/** v0.9 the legal limit a crew member reached (UPDATE-0.9.md §T.1). */
export type OohLimit = 'fdp' | 'duty7d' | 'duty14d' | 'duty28d' | 'block28d' | 'blockYear' | 'block12m' | 'rest' | 'recovery' | 'inflightRest'
  /** v0.9 §R: the month's days off would fall below 7. */
  | 'daysOff';

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
  /** v0.7.3 planned extension (CS FTL.1.205(b)); set only by the planner. */
  ext?: true;
  /** v0.7.3 split duty (CS FTL.1.220): where, net break, crew room or hotel, the flight after the break. */
  split?: { at: string; net: number; room: 'lounge' | 'hotel'; flightId: string };
  /** v0.7.3 Table 2/3 max FDP (discretion base after an extension). */
  basicFdp?: number;
  /** v0.7.3 cabin crew report this much before the pilots (absent = type default; 0 when their table would bind). */
  cabinEarly?: number;
  /** v0.7.3 extra cabin crew the rest plan needs. */
  restExtra?: number;
  /** v0.7.3 report time the crew were told (delayed reporting, CS FTL.1.205(d)). */
  notified?: Minute;
  /** v0.7.3 the player chose 4 pilots. */
  forceAug?: 2;
  /** v0.7.3 crewed at load from an older save within 72 h: augmentation kept without a rest-plan check. */
  legacyRest?: true;
  /** v0.9 FDP planned at report (report → last scheduled arrival then): discretion only when this was legal (§U.3). Old saves: computed lazily. */
  plannedFdp?: number;
  /** v0.9 crew slip: this duty takes over (or hands over) at this tech stop (§W). */
  slipAt?: string;
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
  /** v0.7.2 cabin crew hired for several types (family first). */
  families?: RatingFamily[];
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
  refit?: { cabin: Cabin; /** v0.7.2 crew rest seats at the end */ restSeats?: number };
  /** v0.7.3 crew rest refit fitted at the end (home refit or C-check add-on). */
  restFit?: RestRefitId;
  /** v0.7.4 a client cabin reconfiguration ('in' before the contract, 'out' the change back): the client's share is invoiced at the end. */
  clientCabin?: { contractId: string; phase: 'in' | 'out' };
  /** v0.7 lease return check: the aircraft leaves the fleet at the end. */
  leaseReturn?: boolean;
  /** v0.7.1 AOG: how it is being fixed once decided (the card's WHY); undefined while the decision is open or in old saves. */
  fix?: 'local' | 'courier' | 'team';
  /** v0.7.2 C-check at an MRO hub; ferry home legs. */
  hub?: { code: string; name: string; price: number };
  homeIds?: string[];
  /** v0.9 round 4: a C-check inducted inside its interval (judged at induction, not at release). */
  onTime?: boolean;
}

// ======================================================================
// Inbox (B3 owns events/decisions; any module may post messages via engine/messages.ts)
// ======================================================================

export type MessageCat = 'ops' | 'crew' | 'commercial' | 'tech' | 'finance' | 'company' | 'goal';

export interface Ref {
  /** v0.7 'market': an aircraft market offer. v0.7.1 'cash' | 'statement' (Finance), 'decision' (the decision modal). */
  kind: 'flight' | 'aircraft' | 'contract' | 'offer' | 'crew' | 'maint' | 'airport' | 'market' | 'cash' | 'statement' | 'decision'
    /** v0.8 */
    | 'client' | 'rival' | 'event'
    /** v0.9 a department head (Company › Team); v0.9 round 4 a receivable (Finance) for credit control's notes. */
    | 'head' | 'receivable'
    /** v0.11 a ramp inspection, an audit finding (Company › Safety). */
    | 'ramp' | 'audit';
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
  /** v0.7: market alerts (UI may hide them) and ladder steps (celebration). v0.7.1 'crewRed': the red crew-shortage stage (sound hook). */
  topic?: 'market' | 'ladder' | 'crewRed' | /** v0.8 world events (never toast) */ 'world'
    /** v0.9 the red crew-out-of-hours stage; an achievement; a department head's note. */
    | 'crewHours' | 'achievement' | 'head';
  /** v0.7.1 the problem this message is about, and its severity when posted (a snapshot for the badge once the problem is gone). */
  problem?: ProblemRef;
  hurt?: { money: number; pax: number; delayMin: number; level: 'none' | 'low' | 'high' };
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
  | 'refit' | 'leaseReturn'
  /** v0.7.1: private jets chartered to position crew. */
  | 'crewJet'
  /** v0.8: dry lease out rent and reserves; war-risk insurance per landing. */
  | 'leaseIncome' | 'warRisk'
  /** v0.11 Operations: diversions (handling, passenger care, hotels), extra handling, ramp fixes, audit corrective actions. */
  | 'disruption' | 'compliance'
  /** v0.11 a ferry company (or the seller) delivering an aircraft we may not ferry ourselves (ETOPS). */
  | 'delivery';

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
  /** v0.9 credit controller: reminders sent (days overdue: 3, 10). */
  chased?: number;
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
  /** v0.10 airframe variant (engines, door layout) where the type has them. */
  variant?: string;
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
  /** v0.7: the market index the rent was priced at (absent = 1). */
  index?: number;
  /** @deprecated v0.7.3: read `rest`. v0.7.2 crew rest fitted (rolled at creation, copied on acquisition). */
  crewRest?: { bunks: boolean; seats: number };
  /** v0.7.3 in-flight rest facilities (rolled at creation, copied on acquisition; old open offers: ??= migrateRest). */
  rest?: AcRest;
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
  /** v0.8 market cycle (ops/market.ts). load: ??= steady until now + 9 months */
  cycle?: { phase: MarketPhase; since: Minute; until: Minute; narrowOff: number; wideOff: number };
  /** v0.8 demand shocks added by segIndex. load: ??= [] */
  shocks?: MarketShock[];
  /** v0.8 last month's indices and fuel (outlook trend arrows). */
  prev?: { narrow: number; wide: number; fuel: number };
}

/** v0.8 ACMI market phase. */
export type MarketPhase = 'boom' | 'steady' | 'soft' | 'slump';
/** v0.8 a demand shock on a segment until a time. */
export interface MarketShock { id: string; seg: 'narrow' | 'wide' | 'all'; delta: number; until: Minute; text: string; eventId?: string }

export interface Rival {
  id: string;
  name: string;
  country: string;
  base: string;
  fleet: { typeId: string; count: number }[];
  /** Price multiplier vs list (0.85–1.2) and service quality 0–1. */
  priceFactor: number;
  quality: number;
  personality: 'cheap' | 'premium' | 'rescue' | 'military' | 'steady' | /** v0.8 */ 'big';
  /** v0.8 (contracts/rivals.ts load). */
  status?: 'active' | 'ceased';
  ceasedAt?: Minute;
  /** v0.8 its Client record (kind 'operator') for sub-charter in. */
  clientId?: string;
  /** v0.8 0–1 how booked this month. */
  load?: number;
  /** v0.8 last 10: fleet changes, jobs it took, hires both ways. */
  log?: [Minute, string][];
  won?: number;
  hiredThem?: number;
  hiredUs?: number;
  /** v0.8 aircraft count 12 months ago (rolling monthly history, newest last, max 13). */
  fleetYearAgo?: number;
  fleetHist?: number[];
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
  | 'decision.expire'
  /** v0.7.1: the hourly crew-shortage ladder tick (crew/control.ts escalateShortages). */
  | 'crew.alert'
  /** v0.7.2: an agreed aircraft sale closes (ops/sale.ts). */
  | 'aircraft.sale'
  /** v0.8: a rival's bid lands; a world event starts / ends; a dry lease starts / is collected. */
  | 'rival.bid' | 'world.start' | 'world.end' | 'lease.out' | 'lease.back'
  /** v0.11 Operations: a timed disruption (mid-flight diversion, a sick call at the hotel). */
  | 'ops.event';

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
  /** v0.8 fix pack: offers' and contracts' `requirements.body` means the client asks for one (older saves: stripped once on load). */
  bodyAsked?: boolean;
  /** Peak-staffing round: busy-month gaps already told in the Inbox ('<month key>|<family>|<role>'; past months pruned). */
  peakWarned?: string[];
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
  /** v0.10.2 technical dispatch reliability by day (day number → [revenue departures, technical failures: off > 15 min
   *  late or cancelled for a technical reason]); 366 days kept. Older saves: seeded at load from onTimeM and the AOGs. */
  techDisp?: Record<number, [number, number]>;
  /** v0.7: illegal-crew and AOG incidents (pruned after 365 days; the Ladder's illegal-duty check). */
  incidents?: [Minute, 'illegalCrew' | 'aog'][];
  /** v0.7: deliveries, days delivery ferries waited for pilots, refits, lease returns and extensions, authority findings. */
  deliveries?: number;
  deliveryWaitDays?: number;
  refits?: number;
  leaseReturns?: number;
  leaseExtensions?: number;
  findings?: number;
  /** v0.7.1 Crew Control: jets chartered and spend, fixes applied by kind, ladder stages reached. load: crewFixes ??= {} */
  jets?: number;
  jetSpend?: number;
  crewFixes?: Partial<Record<CrewFix, number>>;
  crewAmber?: number;
  crewRed?: number;
  /** v0.7.2: std of company legs sub-chartered (90 days); aircraft sold; leases returned early; captain-as-FO duties. */
  subLog?: Minute[];
  /** v0.7.2: reliability lost to sub-charters, all time (≤ 0). */
  subHit?: number;
  /** v0.7.2: [time, clientId, reliability ≤ 0] of recent hand-overs (the 7-day cap per client). */
  subCap?: [Minute, string, number][];
  sales?: number;
  earlyReturns?: number;
  asFo?: number;
  /** v0.7.3 planned extensions, split duties, standby call-ins, crew rest refits, delayed reports, discretion reports, rest plans not possible. */
  extensions?: number;
  splits?: number;
  standbyCalls?: number;
  restRefits?: number;
  delayedReports?: number;
  discretionReports?: number;
  restTooShort?: number;
  /** v0.8 counters (bot print, Company). load: ??= zeros */
  v08?: StatsV08;
  /** v0.9 counters (heads, achievements, slips, out of hours, discretion). load: ??= zeros */
  v09?: StatsV09;
}

export interface StatsV09 {
  /** Revenue sectors in a row flown with a legal crew (counted from the first contract). */
  legalStreak: number;
  /** MonthKey → [departures, held for crew] (crew coverage per month; last 14 kept). */
  cover: Record<number, [number, number]>;
  slips: number; oohRed: number; oohAmber: number; discretionUsed: number; discretionRefused: number;
  headHandled: number; headMistakes: number; jumboLoads: number; lateGovPaid: number; cOnTime: number;
  /** Discretion applied with plannedFdp > maxFdp or before report (bot target 0). */
  discretionPlanned?: number;
  /** First AOG away from base fixed without a sub-charter; standby call-ins; augmented duties flown with a legal rest plan; 747 revenue sectors. */
  outstationFix?: number; restPlans?: number; queenSectors?: number; antarctic?: number;
  /** Days since the last leg cancelled by us / last overdue check began (for the streak achievements). */
  lastCancel?: Minute; lastOverdue?: Minute;
  /** Signed offers a rival was bidding on; evacuation/repatriation and Hajj contracts completed. */
  firstCall?: number; homeSafe?: number; hajjDone?: number;
  /** Month results by year (calendar-year net). */
  yearNet?: Record<number, number>;
  /** MonthKey → [revenue departures, on time (≤ 15 min)] (the clockwork achievement; last 14 kept). */
  onTimeM?: Record<number, [number, number]>;
  /** Widebody offers made and those that were jumbo loads (§Y.2: the share is capped). */
  offersWide?: number; offersJumbo?: number;
  /** §R roster planning counters (crew/dayPlan.ts rosterStats). */
  roster?: StatsRoster09;
  /** v0.9 fix: since when Reliable is at the bar (the watch desk). `bigDone` is no longer counted (round 4: every contract counts). */
  bigDone?: number; reliableSince?: Minute;
}

/** v0.9 §R: crew-days by kind (counted as each day closes), call-outs, broken days off, the longest recovery gap seen. */
export interface StatsRoster09 {
  offDays: number; sbyHome: number; sbyHotel: number; asby: number; res: number; leaveDays: number; flying: number; otherDays: number;
  callOuts: number; offBroken: number; offBreaches: number; maxRecGapH: number;
  /** Days off the planner moved for a tour crewed over them (no morale). */
  offMoved?: number;
  /** v0.9 round 3: published days off swapped by agreement for short-notice work (crew control's ask, morale −3). */
  offSwaps?: number;
  /** Crew-months closed and those below 7 days off. */
  months: number; monthsLow: number;
  /** v0.9 round 4: crew-years closed (at the December close) and those below 96 free days pro rata. */
  years?: number; yearsLow?: number;
}

// ======================================================================
// v0.9 Department heads (ops/heads.ts) and achievements (ops/achievements.ts)
// ======================================================================

export type HeadId = 'opsControl' | 'maintPlanner' | 'crewDesk' | 'analyst' | 'credit' | 'fleetPlanner' | 'watch';
export interface HeadCandidate { name: string; years: number; skill: number; salary: number; blurb: string }
export interface HeadLogLine { t: Minute; kind: 'done' | 'mistake' | 'proposal' | 'overridden'; text: string; ref?: Ref }
export interface HeadProposal { id: string; t: Minute; kind: 'ferryHome' | 'position' | 'cSlot' | 'hire'; text: string; cost: number; expires: Minute; ref?: Ref; data: Record<string, string | number> }
export type AlertRuleKind = 'cashBelow' | 'delayOver' | 'offerOver' | 'idleOver' | 'clientDown' | 'checkDue';
export interface AlertRule { id: string; kind: AlertRuleKind; value: number; action: 'pause' | 'alert'; on: boolean }
export interface HeadRules {
  /** opsControl (defaults 120, true). */
  maxDelayMin?: 60 | 120 | 180; standbyFirst?: boolean;
  /** crewDesk (8_000, 0, false). */
  fixMax?: number; jetMax?: number; autoHire?: boolean;
  /** credit (true, true). */
  waiveTrusted?: boolean; depositSlow?: boolean;
  /** fleetPlanner (0 = proposals only). */
  autoFerryMax?: number;
  /** watch (max 8). */
  alerts?: AlertRule[];
}
export interface Head {
  id: HeadId;
  unlockedAt: Minute | null;
  /** Rolled at unlock (3), kept until one is hired. */
  candidates?: HeadCandidate[];
  hired: { name: string; skill: number; salary: number; since: Minute } | null;
  on: boolean;
  rules: HeadRules;
  proposals: HeadProposal[];
  /** Last 12, newest first. */
  log: HeadLogLine[];
  handled: number; mistakes: number; overridden: number;
  /** Fired: candidates come back after this time. */
  firedAt?: Minute;
  /** Watch desk: subjects whose rule already fired (cleared when the condition clears). */
  fired?: string[];
  /** Override watch: [ref id, until] of the items handled in the last 2 h; watch desk: [rule:subject, fire at] held back. */
  recent?: [string, Minute][];
  /** Watch desk: client levels last seen (the "drops a level" rule). */
  seen?: Record<string, number>;
  /** v0.9 round 4: proposals the player dismissed, subject → not again before (14 days, or until the situation changes). */
  dismissed?: Record<string, Minute>;
}

export interface StatsV08 {
  lostToRival: number; subIn: number; dryLeases: number; dryMonths: number; worldEvents: number; closuresHit: number; legsRerouted: number;
  legsFm: number; warRiskPaid: number; injunctions: number; whiteouts: number; levelUps: number; feesWaived: number;
  /** v0.8 our legs delayed by a strike event (ATC, handling). */
  strikeDelays?: number;
  /** Lost-to-rival reasons. */
  lostWhy?: { cheaper: number; closer: number; sooner: number };
  /** Hand-overs by rival id. */
  subByRival?: Record<string, number>;
  /** Day the company became Established / Respected. */
  establishedAt?: Minute; respectedAt?: Minute;
}

/** v0.8 world events (ops/world.ts). */
export type WorldEventKind = 'coup' | 'strike' | 'ash' | 'disaster' | 'airlineFailure' | 'war' | 'airspace' | 'unrest' | 'engineCrisis' | 'recession';
export interface WorldEvent {
  id: string; kind: WorldEventKind;
  /** Template id (data/worldEvents.ts). */
  tpl: string;
  title: string; body: string;
  /** ISO-2 country and the focus airport (map pin). */
  country: string; at: string;
  start: Minute; end: Minute; extended?: boolean;
  /** Zone (data/worldZones.ts); airspace closed while active. */
  zoneId?: string; closed?: boolean;
  /** Airport closed (disasters) until this time. */
  airportClosedUntil?: Minute;
  /** War-risk level for the zone's airports. */
  warRisk?: 1 | 2 | 3;
  /** The airline / rival / ministry involved (text); a rival that ceased. */
  entity?: string; rivalId?: string;
  offerIds: string[]; flightsHit: number; done?: boolean;
  /** Version for the queued start/end. */
  ev?: number;
  /** Offers still to come from it (within 48 h of the start); work kinds left. */
  workLeft?: string[];
  /** Flights rerouted around it so far. */
  rerouted?: number;
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
  /** v0.8 invented world events. load: ??= { events: [] } */
  world?: { events: WorldEvent[]; lastKind?: Partial<Record<WorldEventKind, Minute>> };
  /** v0.9 department heads (ops/heads.ts). load: ??= all locked */
  heads?: Record<HeadId, Head>;
  /** v0.11 the event director (ops/director.ts): busy and quiet spells. load: ??= a fresh director (Normal pace). */
  director?: DirectorState;
  /** v0.11 Operations: disruptions, ramp inspections and the yearly audit (ops/ramp.ts, ops/audit.ts). load: ??= opsDefaults */
  opsx?: OpsState;
  /** v0.9 achievements earned: id → when. load: ??= {} then a silent backfill */
  achievements?: Record<string, Minute>;
  /**
   * v0.9 roster planning (crew/dayPlan.ts): `from` the first base-local midnight the v0.9 rules plan, `publishedTo` the
   * end of the last published day, `planned` the end of the last day whose days off are planned. load: old saves plan
   * from the first midnight 14 days ahead.
   */
  dayPlan?: { from: Minute; publishedTo: Minute; planned?: Minute };
  goals: GoalState[];
  stats: Stats;
  /** Binary min-heap ordered by (t, seq). */
  queue: SimEvent[];
  /** Bankruptcy (fail-forward later) or retirement. */
  gameOver: { t: Minute; reason: string } | null;
}

/** Result of a player action (store.act toasts the error or message). */
export type ActionResult<T = undefined> = { ok: true; msg?: string; data?: T } | { ok: false; error: string };

// ======================================================================
// v0.11 Operations (UPDATE 1): the event director, disruptions, ramp inspections, the yearly audit
// ======================================================================

/** Settings → Gameplay → Pace (the UI's setting is pushed into the game: the engine reads it here). */
export type Pace = 'calm' | 'normal' | 'busy';

/** One spell of the director: [start, end, busy 1 / quiet 0]. */
export type Spell = [Minute, Minute, 0 | 1];

export interface DirectorState {
  pace: Pace;
  /** Spells from the current one on (past ones pruned after 60 days), contiguous. */
  spells: Spell[];
  /** Spells drawn so far (side-stream index, deterministic). */
  n: number;
  /** Closed days by kind (whole UTC days): quiet, busy. */
  days?: { quiet: number; busy: number };
}

/** EASA ramp inspection programme: SAFA (third-country operators), SACA (EU operators), or the local authority abroad. */
export type RampProgramme = 'SAFA' | 'SACA' | 'local';

export interface RampCheck {
  id: string;
  t: Minute;
  at: string;
  aircraftId: string;
  reg: string;
  prog: RampProgramme;
  /** Findings by category (Cat 1 minor, Cat 2 significant, Cat 3 major). */
  cats: [number, number, number];
  /** One plain line per finding: [category, text]. */
  items: [1 | 2 | 3, string][];
  /** Class of action: 1 information, 2 information to the operator/authority, 3a restriction, 3b fix before flight, 3c detained. */
  action: '1' | '2' | '3a' | '3b' | '3c' | null;
  /** Time to rectify (min) and its cost. */
  fixMin: number;
  cost: number;
}

export type AuditLevel = 1 | 2;

export interface AuditFinding {
  id: string;
  level: AuditLevel;
  /** Area code (ops manual, FTL, maintenance, training, ramp, quality). */
  area: 'ftl' | 'ramp' | 'tech' | 'checks' | 'training' | 'quality';
  /** 'Crew flew over their FTL limits'. */
  text: string;
  /** The record behind it. */
  why: string;
  raised: Minute;
  due: Minute;
  /** The corrective action that closes it. */
  task: { label: string; cost: number; days: number };
  started?: Minute;
  /** When the started action completes (the finding closes). */
  ready?: Minute;
  closed?: Minute;
  /** The deadline passed with the finding open. */
  overdue?: boolean;
}

export interface AuditState {
  /** Next audit date, and whether its 4-week notice was given. */
  next: Minute;
  announced?: boolean;
  last?: Minute;
  findings: AuditFinding[];
  /** Approvals suspended since (an overdue finding); null when none. */
  suspended?: Minute | null;
  /** Past audits: [time, level 1, level 2]. */
  history: [Minute, number, number][];
}

export interface OpsState {
  /** Disruptions (and ramp checks, findings) by kind and year: year → kind → count. */
  counts: Record<number, Record<string, number>>;
  /** Ramp inspections of the last 400 days, newest last. */
  ramp: RampCheck[];
  audit: AuditState;
  /** Timed disruption events by id (queued as 'ops.event'). */
  pending: Record<string, { kind: DisruptKind | 'sickCall'; flightId?: string; dutyId?: string; t: Minute; cause?: DisruptCause }>;
  /** ORO.CC.100 reduced cabin crew reports filed (the audit reads them). */
  reducedReports?: Minute[];
  /** Aircraft-days spent grounded with a check overdue (day starts; the audit reads the last year). */
  grounded?: Minute[];
}
