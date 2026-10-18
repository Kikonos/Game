import { AIRPORT_BY_CODE } from '../data/airports';
import { AI_AIRLINES } from '../data/flavor';
import { CONTINENT_ORDER, type ContinentId } from '../data/regions';
import { BASE_FUEL_PRICE } from './economy';
import { scheduleYear } from './events';
import { seedMarkets } from './market';
import * as R from './rng';
import { emptyMonth, message } from './state';
import type { Difficulty, GameState, Livery } from './types';
import { START_YEAR } from './util';

export const SAVE_VERSION = 1;

export interface NewGameOptions {
  name: string;
  code: string;
  ceo: string;
  livery: Livery;
  hub: string;
  difficulty: Difficulty;
  seed?: number;
}

export const DIFFICULTY: Record<Difficulty, { label: string; cash: number; reputation: number; desc: string }> = {
  easy: { label: 'Relaxed', cash: 60_000_000, reputation: 55, desc: '$60M starting capital. A forgiving start for learning the ropes.' },
  normal: { label: 'Standard', cash: 40_000_000, reputation: 50, desc: '$40M starting capital. The intended experience.' },
  hard: { label: 'Cut-throat', cash: 25_000_000, reputation: 42, desc: '$25M and an unknown brand. Every decision counts.' },
};

export function createGame(o: NewGameOptions): GameState {
  const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
  const hub = AIRPORT_BY_CODE[o.hub];
  const d = DIFFICULTY[o.difficulty];
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seed,
    day: 0,
    nextId: 0,
    airline: {
      name: o.name.trim() || 'Contrail Air',
      code: o.code.toUpperCase().slice(0, 2) || 'CT',
      ceo: o.ceo.trim() || 'CEO',
      livery: o.livery,
      homeRegion: hub.region,
      difficulty: o.difficulty,
    },
    cash: d.cash,
    reputation: d.reputation,
    xp: 0,
    level: 1,
    hubs: [{ code: hub.code, openedDay: 0, upgrades: { lounge: false, maintenance: false, connections: false } }],
    unlockedRegions: [hub.region],
    licenses: { longHaul: false, revenueMgmt: false },
    fleet: [],
    routes: [],
    loans: [],
    finance: { current: emptyMonth(START_YEAR * 12), history: [], negativeMonths: 0 },
    market: {
      fuel: BASE_FUEL_PRICE,
      fuelHistory: [BASE_FUEL_PRICE],
      econ: Object.fromEntries(CONTINENT_ORDER.map((c) => [c, 1])) as Record<ContinentId, number>,
      trend: {},
      used: [],
      leases: [],
      deals: [],
    },
    competition: {},
    modifiers: [],
    policies: {
      cateringY: 1, cateringPremium: 0, bagsFee: true, wifi: 0, maintenance: 1,
      autoMaint: true, autoMaintThreshold: 50, autoPricing: false,
    },
    loyalty: { active: false, members: 0, since: 0 },
    campaigns: [],
    hedge: null,
    stats: {
      totalPax: 0, totalFlights: 0, weekPax: 0, weeklyPax: [], weeklyProfit: [], weekProfit: 0, yearPax: 0,
      lastYearPax: 0, destinationsEver: [], reliability: 0.98, avgQuality: 50, peakFleet: 0,
    },
    completedGoals: [],
    messages: [],
    decisions: [],
    contracts: [],
    ai: AI_AIRLINES.map((a, i) => ({ ...a, id: `ai${i}`, growth: 0.02 })),
    familiesTrained: [],
    crewMult: 1,
    feeMult: {},
    flags: {},
    gameOver: null,
    yearReview: null,
  };
  for (const ai of state.ai) ai.growth = R.range(state, 0.015, 0.05);
  seedMarkets(state);
  scheduleYear(state, START_YEAR);
  scheduleYear(state, START_YEAR + 1);
  message(state, 'info', 'news', `${state.airline.name} is cleared for take-off`,
    `Welcome aboard, ${state.airline.ceo}. Your board has given you $${(d.cash / 1e6).toFixed(0)}M and a base at ${hub.city} (${hub.code}). Lease or buy your first aircraft, open a route and start flying!`);
  return state;
}
