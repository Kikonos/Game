import type { ContinentId } from '../data/regions';
import type { CabinClass } from '../data/seats';
import type { CabinConfig, Seats } from './cabin';

export type Speed = 0 | 1 | 2 | 3 | 4;
export type Difficulty = 'easy' | 'normal' | 'hard';
export type TailStyle = 'solid' | 'split' | 'stripe' | 'sweep';

export interface Livery {
  primary: string;
  secondary: string;
  tail: TailStyle;
}

export type AircraftStatus = 'delivering' | 'active' | 'maintenance' | 'refit' | 'ferry';

export interface Assignment {
  routeId: string;
  /** Round trips per week. */
  freq: number;
}

export interface Aircraft {
  id: string;
  typeId: string;
  reg: string;
  name: string;
  hub: string;
  ownership: 'owned' | 'leased';
  leaseMonthly: number;
  leaseEndDay: number;
  leaseDeposit: number;
  purchasePrice: number;
  bookValue: number;
  /** Day the airframe was built (negative = before the game started). */
  builtDay: number;
  condition: number;
  hours: number;
  cycles: number;
  cabin: CabinConfig;
  status: AircraftStatus;
  statusUntil: number;
  /** Cabin to install when a refit completes. */
  pendingCabin?: CabinConfig;
  assignments: Assignment[];
  acquiredDay: number;
  lifetimeRevenue: number;
  lifetimeCost: number;
  monthRevenue: number;
  monthCost: number;
  lastMonthProfit: number;
  /** Day of last technical disruption. */
  lastDisruption: number;
}

export interface RouteWeek {
  week: number;
  pax: number;
  seats: number;
  rev: number;
  cost: number;
  connPax: number;
}

export interface RouteDay {
  pax: Seats;
  seats: Seats;
  demand: Seats;
  connPax: number;
  rev: number;
  cost: number;
  flights: number;
  share: number;
}

export interface Route {
  id: string;
  from: string;
  to: string;
  dist: number;
  prices: Record<CabinClass, number>;
  createdDay: number;
  promoUntil: number;
  flightNo: number;
  acc: { pax: number; seats: number; rev: number; cost: number; connPax: number; days: number };
  history: RouteWeek[];
  last: RouteDay | null;
  lifetime: { pax: number; rev: number; cost: number };
}

export interface Loan {
  id: string;
  principal: number;
  balance: number;
  rate: number;
  months: number;
  monthsLeft: number;
  payment: number;
  takenDay: number;
}

export interface UsedListing {
  id: string;
  typeId: string;
  builtDay: number;
  condition: number;
  price: number;
  cabin: CabinConfig;
  seller: string;
  expiresDay: number;
}

export interface LeaseOffer {
  id: string;
  typeId: string;
  isNew: boolean;
  builtDay: number;
  condition: number;
  monthly: number;
  termMonths: number;
  deliveryDays: number;
  qty: number;
  lessor: string;
  expiresDay: number;
}

export interface HubUpgrades {
  lounge: boolean;
  maintenance: boolean;
  connections: boolean;
}

export interface Hub {
  code: string;
  openedDay: number;
  upgrades: HubUpgrades;
}

export type ModKind = 'demand' | 'capacity' | 'crew' | 'fees';
export type ModScope = 'global' | 'continent' | 'region' | 'country' | 'airport';

export interface Modifier {
  id: string;
  kind: ModKind;
  scope: ModScope;
  targets: string[];
  mult: number;
  startDay: number;
  endDay: number;
  label: string;
}

export interface Competition {
  level: number;
  /** Competitor fare index (1 = market price, lower = aggressive). */
  priceIdx: number;
  name?: string;
  /** Day rivals last reacted to the player on this route (capacity or fare war). */
  lastMove?: number;
}

export type AlertKind = 'competition' | 'cash' | 'fleet' | 'route' | 'event';

/**
 * Something the player should not miss at high game speed. Raised by the engine during
 * the latest simulated day (cleared at the start of each day); the UI decides how to react.
 */
export interface Alert {
  kind: AlertKind;
  title: string;
  body: string;
  /** Inbox message that carries the details. */
  msgId: string;
  /** Similar alerts merged into this one on the same day. */
  count: number;
}

export type MsgKind = 'info' | 'good' | 'warn' | 'bad' | 'event';
export type MsgCategory = 'news' | 'ops' | 'finance' | 'fleet' | 'goal' | 'market';

export interface Message {
  id: string;
  day: number;
  kind: MsgKind;
  category: MsgCategory;
  title: string;
  body: string;
  read: boolean;
}

export interface DecisionOption {
  id: string;
  label: string;
  desc: string;
}

export interface PendingDecision {
  id: string;
  eventId: string;
  day: number;
  title: string;
  body: string;
  options: DecisionOption[];
  data: Record<string, string | number>;
}

export type CampaignType = 'social' | 'regional' | 'global' | 'route';

export interface Campaign {
  id: string;
  type: CampaignType;
  target: string;
  startDay: number;
  endDay: number;
  boost: number;
}

export const REV_CATS = ['tickets', 'ancillary', 'cargo', 'other'] as const;
export const EXP_CATS = [
  'fuel', 'crew', 'maintenance', 'airport', 'navigation', 'service', 'distribution', 'leases', 'depreciation',
  'interest', 'overhead', 'stations', 'marketing', 'insurance', 'training', 'licenses', 'other',
] as const;
export type RevCat = (typeof REV_CATS)[number];
export type ExpCat = (typeof EXP_CATS)[number];

export interface MonthFinance {
  key: number;
  rev: Record<RevCat, number>;
  exp: Record<ExpCat, number>;
  capex: number;
  assetSales: number;
  cashEnd: number;
  pax: number;
  flights: number;
}

export interface AiAirline {
  id: string;
  name: string;
  code: string;
  color: string;
  continent: ContinentId;
  paxM: number;
  fleet: number;
  growth: number;
}

export interface Policies {
  /** 0 none (buy on board), 1 snack, 2 meal */
  cateringY: 0 | 1 | 2;
  /** 0 standard, 1 gourmet */
  cateringPremium: 0 | 1;
  bagsFee: boolean;
  /** 0 none, 1 paid, 2 free */
  wifi: 0 | 1 | 2;
  /** 0 light, 1 standard, 2 premium */
  maintenance: 0 | 1 | 2;
  autoMaint: boolean;
  autoMaintThreshold: number;
  autoPricing: boolean;
}

export interface AirlineInfo {
  name: string;
  code: string;
  ceo: string;
  livery: Livery;
  homeRegion: string;
  difficulty: Difficulty;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  day: number;
  nextId: number;
  airline: AirlineInfo;
  cash: number;
  reputation: number;
  xp: number;
  level: number;
  hubs: Hub[];
  unlockedRegions: string[];
  licenses: { longHaul: boolean; revenueMgmt: boolean };
  fleet: Aircraft[];
  routes: Route[];
  loans: Loan[];
  finance: { current: MonthFinance; history: MonthFinance[]; negativeMonths: number };
  market: {
    fuel: number;
    fuelHistory: number[];
    econ: Record<ContinentId, number>;
    trend: Record<string, number>;
    used: UsedListing[];
    leases: LeaseOffer[];
    deals: { typeId: string; discount: number; until: number }[];
  };
  competition: Record<string, Competition>;
  modifiers: Modifier[];
  policies: Policies;
  loyalty: { active: boolean; members: number; since: number };
  campaigns: Campaign[];
  hedge: { pct: number; price: number; until: number } | null;
  /**
   * Price levels relative to 2026: costs inflate every January, market fares follow only partly.
   * `relief` eases saves from before the 2026 rebalance into the new cost levels (fades over a year).
   */
  inflation: { cost: number; fare: number; relief?: number };
  /** Alerts raised by the most recent advanceDay(). */
  alerts: Alert[];
  stats: {
    totalPax: number;
    totalFlights: number;
    weekPax: number;
    weeklyPax: number[];
    weeklyProfit: number[];
    weekProfit: number;
    yearPax: number;
    lastYearPax: number;
    destinationsEver: string[];
    reliability: number;
    avgQuality: number;
    /** Most aircraft in service at once (growth XP is only paid for new records). */
    peakFleet: number;
    bestMonthPax: number;
    bestMonthProfit: number;
  };
  completedGoals: string[];
  messages: Message[];
  decisions: PendingDecision[];
  contracts: Contract[];
  ai: AiAirline[];
  familiesTrained: string[];
  crewMult: number;
  feeMult: Record<string, number>;
  flags: Record<string, number>;
  gameOver: { reason: string; day: number } | null;
  /** Year-in-review data waiting to be shown. */
  yearReview: YearReview | null;
}

export interface Contract {
  id: string;
  from: string;
  to: string;
  monthly: number;
  minFreq: number;
  monthsLeft: number;
  /** Day by which the route must be flying. */
  deadline: number;
  active: boolean;
}

export interface YearReview {
  year: number;
  pax: number;
  revenue: number;
  profit: number;
  fleet: number;
  routes: number;
  reputation: number;
  rank: number;
  bestRoute: string | null;
}
