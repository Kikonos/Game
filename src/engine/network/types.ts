// v0.19 "Scheduled routes" (docs/UPDATE-0.19.md §R): the network's state and data shapes. core/types.ts re-exports
// them. Step 0: shapes only; owners per field in §T (net-engine: study, sales, pnl, reputation; net-ops: series,
// rotations, flights, conflicts).

import type { CabinLayout } from '../../data/acmiTypes';
import type { Minute, MonthKey } from '../core/types';

/** §A own brand (we sell), for a partner (white label, the partner sells), a charter series sold by our tour operator. */
export type RouteModel = 'own' | 'partner' | 'tour';

export type RouteStatus = 'study' | 'case' | 'launching' | 'onSale' | 'operating' | 'suspended' | 'closed';

/** §C the eleven launch stages, in order. */
export type LaunchStageId =
  | 'study' | 'case' | 'rights' | 'slots' | 'brand' | 'distribution' | 'filing' | 'marketing' | 'stations' | 'familiarisation' | 'inaugural';

export const LAUNCH_STAGES: readonly LaunchStageId[] = [
  'study', 'case', 'rights', 'slots', 'brand', 'distribution', 'filing', 'marketing', 'stations', 'familiarisation', 'inaugural',
];

export type LaunchStageState = 'todo' | 'running' | 'waiting' | 'done' | 'delayed' | 'failed';

export interface LaunchStage {
  id: LaunchStageId;
  state: LaunchStageState;
  start?: Minute;
  /** Expected end (moves with setbacks). */
  due?: Minute;
  /** Money booked for the stage so far (USD). */
  cost: number;
  /** The setback that hit it, in plain words. */
  setback?: string;
}

export type StudyDepth = 'desk' | 'full' | 'survey';

/** §C stage 1: the market study and its estimate (passengers a week, both ways). `truth` is hidden from the player. */
export interface RouteStudy {
  depth: StudyDepth;
  start: Minute;
  done?: Minute;
  est?: { p10: number; p50: number; p90: number };
  truth: number;
  validUntil?: Minute;
  /**
   * v0.22 the estimate as the study gave it, for the market it was made on: kept once the stop is changed at the
   * business case (advice.ts setStop), so every re-reading starts from it (going back gives the same numbers).
   */
  ref?: { marketId: string; custom?: import('../../data/routes').RouteMarket; model: RouteModel; est: { p10: number; p50: number; p90: number } };
}

/** §E demand segments. */
export type Segment = 'vfr' | 'gov' | 'ngo' | 'biz' | 'students' | 'tourism' | 'teachers';

/** §D.1 one timetable series: a pattern of dated rotations with the same times, aircraft type and cabin. */
export interface RouteSeries {
  id: string;
  /** Days of the week (bit 0 = Monday … bit 6 = Sunday), for weekly / every-N-weeks series. */
  days: number;
  /** Every N weeks (1 weekly, 2 fortnightly); ignored when `monthly` is set. */
  every: number;
  /** Monthly: the nth (1–4, −1 = last) weekday (0 = Monday) of the month. */
  monthly?: { nth: number; weekday: number };
  /** Local departure time (minutes after local midnight) of the first out sector and of the first back sector. */
  out: number;
  back: number;
  /** Nights at the destination (0 = a day turn). */
  nights: number;
  typeId: string;
  layout: CabinLayout;
  /** A pinned aircraft (else the planner picks, §D.3). */
  tail?: string;
  /** The dates the series runs (normally one IATA season). */
  from: Minute;
  to: Minute;
}

/** §J.1 one sector of a rotation: seats, bookings, what flew, its money. */
export interface SectorLoad {
  from: string;
  to: string;
  flightId?: string;
  capJ: number;
  capY: number;
  bookedJ: number;
  bookedY: number;
  flownJ?: number;
  flownY?: number;
  /** Passengers denied boarding (seats short, overbooking). */
  denied?: number;
  /** Cargo carried (kg); live animals and mail inside it. */
  cargoKg: number;
  aviKg?: number;
  mailKg?: number;
  /** Revenue and direct cost booked for this sector (USD) once flown. */
  rev?: number;
  cost?: number;
  onTime?: boolean;
  /** Ticket cash (USD) taken for this sector and held as unearned until it flies (sales.ts keeps it; a refund takes it). */
  sold?: number;
  /** Seats of a group block held on this sector (sold at the block fare; unsold ones are released 21 days out). */
  blockY?: number;
  /** When the sector left (revenue accrued once: at departure, or at arrival for a sub-chartered sector). */
  accrued?: true;
  /** Cancelled on the day by operations: tickets refunded and passengers compensated once. */
  voided?: true;
  /** What a rival charged to fly this sector for us (USD; counted in the sector's cost at arrival). */
  subCost?: number;
  /** v0.21 a stopover route: the local passengers booked on this sector alone (A–B on the first, B–C on the second; the rest fly through). */
  localJ?: number;
  localY?: number;
  /** v0.21 a stopover route's first sector of a direction: the through passengers who flew it (they stay on at the stop). */
  thruJ?: number;
  thruY?: number;
}

export type RotationStatus = 'planned' | 'flights' | 'flown' | 'cancelled';

/** §D.2 one dated departure of a series: out and back, every sector. */
export interface Rotation {
  id: string;
  routeId: string;
  seriesId: string;
  /** Scheduled departure of the first sector (UTC). */
  dep: Minute;
  status: RotationStatus;
  sectors: SectorLoad[];
  aircraftId?: string | null;
  /** Rival id when another operator flies it for us (§H.4). */
  operatedBy?: string;
  /** §E.4 open economy buckets (Flex is always open). */
  buckets?: { saver: boolean; classic: boolean };
  /** Minutes moved in total by the player (§H.5). */
  moved?: number;
  /** When passengers were told of the last change. */
  notice?: Minute;
  /** Passengers moved to our next rotation, to a rival, or refunded when it was cancelled. */
  reprotect?: { ours: number; rival: number; refunded: number };
  /** The no-aircraft card was given. */
  carded?: true;
}

/** §J.2 a route's month. Revenue positive, costs positive amounts (the result is rev − direct − acTime). */
export interface RoutePnl {
  rev: number;
  tickets: number;
  cargo: number;
  ancillary: number;
  direct: number;
  /** Aircraft and crew time at cost (not a ledger line). */
  acTime: number;
  result: number;
  pax: number;
  seats: number;
  bh: number;
  sectors: number;
  onTime: number;
  cargoKg: number;
  /** Launch spend booked this month. */
  launch: number;
  /** v0.21 passengers counted on every sector they sit on (the load factor's top; `seats` is per sector). Absent before v0.21: `pax`. */
  paxSec?: number;
}

/** §E.4 the player's fare stance. */
export type FareLevel = 'low' | 'market' | 'high';
export type MarketingLevel = 'low' | 'normal' | 'high';

export interface Route {
  id: string;
  /** data/routes.ts ROUTE_MARKETS id, e.g. 'LIS-OXB'; v0.19.2 a custom market's id ('X:LIS-JFK', custom.ts). */
  marketId: string;
  /** v0.19.2 the market of a route the player built (custom.ts), kept as it was when the study was ordered. */
  custom?: import('../../data/routes').RouteMarket;
  model: RouteModel;
  /** The partner's client id (model 'partner'). */
  partnerId?: string;
  /** Route number for flight numbers (odd out, even back). */
  flightNo: number;
  status: RouteStatus;
  opened: Minute;
  stages: LaunchStage[];
  study?: RouteStudy;
  series: RouteSeries[];
  rotations: Rotation[];
  fares: { level: FareLevel; saleUntil?: Minute; overbook?: boolean };
  marketing: MarketingLevel;
  /** 0–1 (§E.2). */
  awareness: number;
  /** 0–100 (§I). */
  reputation: number;
  /** Ticket cash taken for sectors not yet flown (§N.2). */
  unearned: number;
  /** §D.5 the LIS slot series this season. */
  slots?: { held: number; flown: number; season: string };
  tanker?: boolean;
  pnl: Record<MonthKey, RoutePnl>;
  /** The route contracts (one per IATA season). */
  contractIds: string[];
  firstFlight?: Minute;
  closed?: Minute;
  /** Demand dents (ops: business class lost, late moves): demand × x for that class until the date. */
  dents?: RouteDent[];
  /** The plan chosen at Go (the business case's draft): what the launch files and sells. */
  plan?: RoutePlan;
  /** Cards already given once (key → when): weak pace, no aircraft, a waiting decision's reminder. */
  told?: Record<string, Minute>;
  /** The partner's fee a block hour (partner model), fixed at Go (a better fee won at the brand stage raises it). */
  partnerFeeBH?: number;
  /** Stations without a caterer up to the standard (double catering from Lisbon); fuel on cash terms. */
  noCaterer?: string[];
  /** A rival's reaction to the launch: its fare cut until a date. */
  rivalCut?: { x: number; until: Minute };
  /** Rotations flown in a row with the cabin advertised (product consistency, §I). */
  consistent?: number;
  /** Ticket refunds and passenger costs this month (route P&L), and the month's launch spend. */
  monthPax?: number;
  /** v0.21 a stopover route: the B–C (fifth-freedom) rights won at the rights stage (absent before it). */
  fifth?: FifthRights;
}

/** v0.21 fifth-freedom rights at a stopover: sell B–C seats freely, a limited share of them, or not at all. */
export type FifthRights = 'full' | 'limited' | 'none';

/** The plan the player drafts in the business case (and the launch files): pattern, times, aircraft, fares. */
export interface RoutePlan {
  model: RouteModel;
  days: number;
  every: number;
  monthly?: { nth: number; weekday: number };
  out: number;
  back: number;
  nights: number;
  typeId: string;
  layout?: CabinLayout;
  fares: FareLevel;
  marketing: MarketingLevel;
}

/** A temporary dent in a route's demand (J only, or all passengers). */
export interface RouteDent {
  cls: 'J' | 'all';
  x: number;
  until: Minute;
}

export interface NetworkStats {
  launched: number;
  rotations: number;
  pax: number;
  swaps: number;
  subs: number;
  moves: number;
  cancels: number;
  downgrades: number;
}

/** `g.network` (load/init: loadNetwork). */
export interface NetworkState {
  routes: Record<string, Route>;
  /** Our own sales record (a Client with own: true), made at the first launch. */
  ownClientId?: string;
  /** When GDS/BSP distribution was set up (later routes pay half). */
  distribution?: Minute;
  /** The BSP bank guarantee held in cash. */
  bspHold?: { amount: number; until: Minute };
  /** Ticket money sold through travel agents, paid to us by BSP on the 15th and the last day of the month (USD). */
  bspDue?: number;
  stats: NetworkStats;
  /** UI cache key. */
  rev?: number;
}

/** §H.2 what to do with a rotation an ACMI job needs the aircraft of. */
export type RouteChoice = 'swap' | 'sub' | 'move' | 'cancel';

/** Flight.sched: a route flight's place in its rotation. */
export interface FlightSched {
  routeId: string;
  rotId: string;
  /** Sector index in the rotation. */
  idx: number;
}
