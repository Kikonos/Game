// v0.19 the Network UI's calls into the engine (engine/network). One place, so the screens read the same answers and
// the lanes' APIs plug in here. Every call is pure unless it says it changes the game (those run inside store.act).

import * as NET from '../../../engine/network';
import type { CabinLayout } from '../../../data/acmiTypes';
import type { GameState, Minute } from '../../../engine/core/types';
import type { FareLevel, MarketingLevel, Route, RouteChoice, RouteModel, RouteSeries, StudyDepth } from '../../../engine/network/types';

/** UPDATE-0.19 additions 3 (a): the study's recommended timetable and its demand ranges by month. */
export interface Recommendation {
  freq: number;
  days: number;
  every?: number;
  monthly?: { nth: number; weekday: number };
  out: number;
  back?: number;
  nights?: number;
  gauge: 'narrow' | 'mid' | 'big';
  typeId: string;
  types?: string[];
  model: RouteModel;
  why: string[];
  /** 12 months (Jan … Dec): passengers a week both ways, P10/P50/P90. */
  months?: { p10: number; p50: number; p90: number }[];
}

/** The plan the player drafts in the business case (deviations from the recommendation). */
export interface CaseDraft {
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
  /** v0.23.2 fly only the market's season. */
  season?: true;
}

export interface CaseBand {
  paxPerSector: number;
  lf: number;
  rev: number;
  cost: number;
  result: number;
  margin: number;
}

/** §C the first 12 months at P10/P50/P90 for a draft, plus the deviations' consequences in words. */
export interface BusinessCase {
  p10: CaseBand;
  p50: CaseBand;
  p90: CaseBand;
  breakEvenLf: number;
  paybackWeeks: number | null;
  launchCost: number;
  /** What the planned aircraft would earn on ACMI in those hours. */
  acmi: number;
  /** "2/wk takes off-peak LF from 72 % to 49 %" … */
  notes: string[];
  firstFlight?: Minute;
}

/** UPDATE-0.19 additions 3 (b) the live numbers of a route flight (map card and panel). */
export interface SectorLive {
  paxJ: number;
  paxY: number;
  seatsJ: number;
  seatsY: number;
  lf: number;
  cargoKg: number;
  aviKg: number;
  mailKg?: number;
  revenue: number;
  cost: number;
  profit: number;
  flown: boolean;
  next?: { flightNo: string; std: Minute; bookedJ: number; bookedY: number; seatsJ: number; seatsY: number; lfForecast: number; vsCurve: number };
}

export interface MoveQuoteView {
  ok: boolean;
  why?: string;
  dep: Minute;
  cost: number;
  repDelta: number;
  notes?: string[];
  knock?: string[];
  crew?: string;
  slot?: string;
  pax?: number;
}

const N = NET as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>;
function call<T>(name: string, fallback: T, ...args: unknown[]): T {
  const f = N[name];
  if (typeof f !== 'function') return fallback;
  try {
    return (f(...args) as T) ?? fallback;
  } catch {
    return fallback;
  }
}
const has = (name: string) => typeof N[name] === 'function';

export const net = {
  has,
  /** Starts the study (changes the game). */
  startStudy: (g: GameState, marketId: string, depth: StudyDepth, model?: RouteModel): { routeId?: string; why?: string } => (NET.startStudy as (g: GameState, m: string, d: StudyDepth, model?: RouteModel) => { routeId?: string; why?: string })(g, marketId, depth, model),
  recommend: (g: GameState, routeId: string): Recommendation | null => call<Recommendation | null>('recommendation', null, g, routeId),
  businessCase: (g: GameState, routeId: string, draft: CaseDraft): BusinessCase | null => call<BusinessCase | null>('businessCase', null, g, routeId, draft),
  defaultDraft: (g: GameState, routeId: string): CaseDraft | null => call<CaseDraft | null>('caseDraft', null, g, routeId),
  /** Go / change / shelve (changes the game). */
  decide: (g: GameState, routeId: string, d: 'go' | 'change' | 'shelve', draft?: CaseDraft): string | null => (N.decideCase as (g: GameState, id: string, d: string, draft?: CaseDraft) => string | null)(g, routeId, d, draft),
  stopLaunch: (g: GameState, routeId: string): string | null => call<string | null>('stopLaunch', 'Not available yet.', g, routeId),
  answerSlot: (g: GameState, routeId: string, accept: boolean): string | null => call<string | null>('answerSlot', 'Not available yet.', g, routeId, accept),
  sectorLive: (g: GameState, flightId: string): SectorLive | null => call<SectorLive | null>('sectorLive', null, g, flightId),
  acmiCompare: (g: GameState, routeId: string): string | null => call<string | null>('acmiCompare', null, g, routeId),
  quoteMove: (g: GameState, rotId: string, delta: number): MoveQuoteView => NET.quoteMoveRotation(g, rotId, delta) as MoveQuoteView,
  move: (g: GameState, rotId: string, delta: number): boolean => NET.moveRotation(g, rotId, delta),
  cancel: (g: GameState, rotId: string): boolean => NET.cancelRotation(g, rotId),
  quoteCancel: (g: GameState, rotId: string): { ok: boolean; cost: number; refunds: number; why?: string; subBack?: number; subFee?: number } | null => call('quoteCancelRotation', null, g, rotId),
  setSeries: (g: GameState, routeId: string, s: RouteSeries): string | null => NET.setSeries(g, routeId, s),
  removeSeries: (g: GameState, routeId: string, seriesId: string, from?: Minute): string | null => call<string | null>('removeSeries', 'Not available yet.', g, routeId, seriesId, from),
  conflicts: (g: GameState, aircraftId: string, from: Minute, to: Minute) => NET.routeConflicts(g, aircraftId, from, to),
  choices: (g: GameState, rotId: string, opts?: { aircraftId?: string; from?: Minute; to?: Minute }) => NET.rotationChoices(g, rotId, opts),
  resolve: (g: GameState, rotId: string, c: RouteChoice, expect?: { net?: number }) => NET.resolveRotation(g, rotId, c, expect),
  setFares: (g: GameState, routeId: string, level: FareLevel) => setRoute(g, routeId, 'setFareLevel', (r) => { r.fares.level = level; }, level),
  setOverbook: (g: GameState, routeId: string, on: boolean) => setRoute(g, routeId, 'setOverbook', (r) => { r.fares.overbook = on || undefined; }, on),
  setMarketing: (g: GameState, routeId: string, level: MarketingLevel) => setRoute(g, routeId, 'setMarketing', (r) => { r.marketing = level; }, level),
  setTanker: (g: GameState, routeId: string, on: boolean) => setRoute(g, routeId, 'setTanker', (r) => { r.tanker = on || undefined; }, on),
  runSale: (g: GameState, routeId: string): string | null => call<string | null>('runSale', 'Not available yet.', g, routeId),
  saleBlock: (g: GameState, routeId: string): string | null => call<string | null>('saleBlock', null, g, routeId),
};

/** A route setting: the engine's own setter when it has one, else the field itself (no money moves). */
function setRoute(g: GameState, routeId: string, fn: string, apply: (r: Route) => void, v: unknown): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  if (has(fn)) return call<string | null>(fn, null, g, routeId, v);
  apply(r);
  if (g.network) g.network.rev = (g.network.rev ?? 0) + 1;
  return null;
}
