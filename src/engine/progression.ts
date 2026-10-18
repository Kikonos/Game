// Airline levels, region/continent unlocks, hubs and goals.

import { AIRCRAFT_BY_ID, isWidebody } from '../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS_BY_REGION } from '../data/airports';
import { CONTINENT_ORDER, CONTINENTS, type ContinentId, REGIONS, REGION_BY_ID } from '../data/regions';
import { airportMass } from './demand';
import { monthProfit } from './economy';
import { destinationsServed, homeContinent, message } from './state';
import type { GameState } from './types';
import { clamp } from './util';

export interface LevelInfo {
  level: number;
  title: string;
  xp: number;
}

export const LEVELS: LevelInfo[] = [
  { level: 1, title: 'Startup', xp: 0 },
  { level: 2, title: 'Commuter Carrier', xp: 2_500 },
  { level: 3, title: 'Regional Airline', xp: 9_000 },
  { level: 4, title: 'National Carrier', xp: 24_000 },
  { level: 5, title: 'Continental Carrier', xp: 55_000 },
  { level: 6, title: 'Major Airline', xp: 130_000 },
  { level: 7, title: 'Intercontinental Carrier', xp: 280_000 },
  { level: 8, title: 'Global Carrier', xp: 550_000 },
  { level: 9, title: 'Mega Carrier', xp: 1_000_000 },
  { level: 10, title: 'Legendary Airline', xp: 1_800_000 },
];

export function levelInfo(level: number): LevelInfo {
  return LEVELS[clamp(level, 1, LEVELS.length) - 1];
}

export function levelProgress(state: GameState): { cur: LevelInfo; next: LevelInfo | null; pct: number } {
  const cur = levelInfo(state.level);
  const next = state.level < LEVELS.length ? levelInfo(state.level + 1) : null;
  const pct = next ? clamp((state.xp - cur.xp) / (next.xp - cur.xp), 0, 1) : 1;
  return { cur, next, pct };
}

export function addXp(state: GameState, amount: number) {
  state.xp += amount;
  while (state.level < LEVELS.length && state.xp >= levelInfo(state.level + 1).xp) {
    state.level += 1;
    const info = levelInfo(state.level);
    message(state, 'good', 'goal', `Level ${state.level}: ${info.title}`, levelUnlockText(state.level));
  }
}

function levelUnlockText(level: number): string {
  const parts: string[] = [];
  const hubs = maxHubs(level);
  if (hubs > maxHubs(level - 1)) parts.push(`You may now operate ${hubs} hubs.`);
  const types = Object.values(AIRCRAFT_BY_ID).filter((t) => t.minLevel === level).map((t) => t.name);
  if (types.length) parts.push(`New aircraft available: ${types.join(', ')}.`);
  if (level === 5) parts.push('You can now apply for a Long-Haul Operations Certificate.');
  parts.push('New expansion opportunities may be available in the Expansion screen.');
  return parts.join(' ');
}

export function maxHubs(level: number): number {
  return [1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 8][clamp(level, 0, 10)];
}

// ---------- expansion ----------

const regionMassCache = new Map<string, number>();
export function regionMass(regionId: string): number {
  let m = regionMassCache.get(regionId);
  if (m === undefined) {
    m = (AIRPORTS_BY_REGION[regionId] ?? []).reduce((s, a) => s + airportMass(a), 0);
    regionMassCache.set(regionId, m);
  }
  return m;
}

const avgRegionMass = () => REGIONS.reduce((s, r) => s + regionMass(r.id), 0) / REGIONS.length;

export interface UnlockOption {
  kind: 'region' | 'continent';
  id: string;
  name: string;
  fee: number;
  level: number;
  requiresLongHaul: boolean;
  available: boolean;
  reason?: string;
}

function extraHomeRegions(state: GameState): number {
  const home = homeContinent(state);
  return state.unlockedRegions.filter((r) => REGION_BY_ID[r].continent === home).length - 1;
}

export function unlockedContinents(state: GameState): ContinentId[] {
  return CONTINENT_ORDER.filter((c) => REGIONS.filter((r) => r.continent === c).every((r) => state.unlockedRegions.includes(r.id)));
}

function foreignContinentsUnlocked(state: GameState): number {
  const home = homeContinent(state);
  return CONTINENT_ORDER.filter(
    (c) => c !== home && REGIONS.some((r) => r.continent === c && state.unlockedRegions.includes(r.id)),
  ).length;
}

export function regionUnlock(state: GameState, regionId: string): UnlockOption {
  const r = REGION_BY_ID[regionId];
  const n = extraHomeRegions(state);
  const level = [2, 2, 3, 3, 4, 4, 5][Math.min(6, n)];
  const size = clamp(regionMass(regionId) / avgRegionMass(), 0.6, 1.8);
  const fee = Math.round((6_000_000 * (1 + 0.45 * n) * size) / 100_000) * 100_000;
  const opt: UnlockOption = { kind: 'region', id: regionId, name: r.name, fee, level, requiresLongHaul: false, available: true };
  if (state.unlockedRegions.includes(regionId)) return { ...opt, available: false, reason: 'Already unlocked' };
  if (r.continent !== homeContinent(state)) return { ...opt, available: false, reason: 'Unlock the whole continent' };
  if (state.level < level) return { ...opt, available: false, reason: `Requires level ${level}` };
  if (state.cash < fee) return { ...opt, available: false, reason: 'Not enough cash' };
  return opt;
}

export function continentUnlock(state: GameState, c: ContinentId): UnlockOption {
  const n = foreignContinentsUnlocked(state);
  const level = [5, 6, 6, 7, 8, 9][Math.min(5, n)];
  const mass = REGIONS.filter((r) => r.continent === c).reduce((s, r) => s + regionMass(r.id), 0);
  const size = clamp(mass / (avgRegionMass() * 3), 0.6, 1.8);
  const fee = Math.round((35_000_000 * (1 + 0.5 * n) * size) / 1_000_000) * 1_000_000;
  const opt: UnlockOption = {
    kind: 'continent', id: c, name: CONTINENTS[c].name, fee, level, requiresLongHaul: true, available: true,
  };
  const home = homeContinent(state);
  if (c === home) {
    const remaining = REGIONS.filter((r) => r.continent === c && !state.unlockedRegions.includes(r.id));
    if (remaining.length === 0) return { ...opt, available: false, reason: 'Already unlocked' };
    return { ...opt, available: false, reason: 'Unlock regions individually' };
  }
  if (REGIONS.filter((r) => r.continent === c).every((r) => state.unlockedRegions.includes(r.id))) {
    return { ...opt, available: false, reason: 'Already unlocked' };
  }
  if (!state.licenses.longHaul) return { ...opt, available: false, reason: 'Requires Long-Haul Certificate' };
  if (state.level < level) return { ...opt, available: false, reason: `Requires level ${level}` };
  if (state.cash < fee) return { ...opt, available: false, reason: 'Not enough cash' };
  return opt;
}

export const LONG_HAUL_LEVEL = 5;
export const LONG_HAUL_FEE = 20_000_000;
export const REVENUE_MGMT_LEVEL = 3;
export const REVENUE_MGMT_FEE = 4_000_000;

// ---------- goals ----------

export interface Goal {
  id: string;
  title: string;
  desc: string;
  reward: { cash: number; xp: number };
  progress: (s: GameState) => number;
  /** Text describing current progress, e.g. "2 / 3". */
  status?: (s: GameState) => string;
}

const fleetCount = (s: GameState) => s.fleet.length;
const activeCount = (s: GameState) => s.fleet.filter((a) => a.status !== 'delivering').length;
const flying = (s: GameState) => s.fleet.filter((a) => a.status === 'active' && a.assignments.some((x) => x.freq > 0)).length;
const ratio = (v: number, target: number) => clamp(v / target, 0, 1);
const lastMonthProfit = (s: GameState) => {
  const m = s.finance.history[s.finance.history.length - 1];
  return m ? monthProfit(m) : 0;
};
const bestYearProfit = (s: GameState) => {
  const h = s.finance.history;
  if (h.length < 12) return h.reduce((a, m) => a + monthProfit(m), 0);
  let best = -Infinity;
  for (let i = 12; i <= h.length; i++) best = Math.max(best, h.slice(i - 12, i).reduce((a, m) => a + monthProfit(m), 0));
  return best;
};
const hasBody = (s: GameState, pred: (id: string) => boolean) =>
  s.fleet.some((a) => a.status !== 'delivering' && pred(a.typeId));

export const GOALS: Goal[] = [
  {
    id: 'first_aircraft', title: 'Wheels Up', desc: 'Buy or lease your first aircraft from the Aircraft Market.',
    reward: { cash: 500_000, xp: 150 }, progress: (s) => ratio(fleetCount(s), 1),
  },
  {
    id: 'first_route', title: 'Open for Business', desc: 'Open your first route from your hub in the Route Planner.',
    reward: { cash: 500_000, xp: 150 }, progress: (s) => ratio(s.routes.length, 1),
  },
  {
    id: 'first_flight', title: 'Maiden Voyage', desc: 'Assign an aircraft to a route and fly your first passengers.',
    reward: { cash: 1_000_000, xp: 250 }, progress: (s) => ratio(s.stats.totalPax, 1),
  },
  {
    id: 'fleet_3', title: 'Growing Fleet', desc: 'Operate three aircraft.',
    reward: { cash: 1_500_000, xp: 300 }, progress: (s) => ratio(activeCount(s), 3), status: (s) => `${activeCount(s)} / 3`,
  },
  {
    id: 'routes_5', title: 'Network Builder', desc: 'Serve five destinations.',
    reward: { cash: 2_000_000, xp: 400 },
    progress: (s) => ratio(destinationsServed(s).length - s.hubs.length, 5),
    status: (s) => `${Math.max(0, destinationsServed(s).length - s.hubs.length)} / 5`,
  },
  {
    id: 'profit_month', title: 'In the Black', desc: 'Close a month with a net profit.',
    reward: { cash: 1_000_000, xp: 400 }, progress: (s) => (lastMonthProfit(s) > 0 ? 1 : 0),
  },
  {
    id: 'pax_100k', title: '100,000 Passengers', desc: 'Carry a total of 100,000 passengers.',
    reward: { cash: 2_000_000, xp: 500 }, progress: (s) => ratio(s.stats.totalPax, 100_000),
  },
  {
    id: 'loadfactor', title: 'Load Master', desc: 'Achieve a weekly load factor of 85% on a route.',
    reward: { cash: 1_000_000, xp: 400 },
    progress: (s) => {
      const best = Math.max(0, ...s.routes.map((r) => {
        const w = r.history[r.history.length - 1];
        return w && w.seats > 0 ? w.pax / w.seats : 0;
      }));
      return ratio(best, 0.85);
    },
  },
  {
    id: 'fleet_10', title: 'Double Digits', desc: 'Operate ten aircraft.',
    reward: { cash: 5_000_000, xp: 1_000 }, progress: (s) => ratio(activeCount(s), 10), status: (s) => `${activeCount(s)} / 10`,
  },
  {
    id: 'region_2', title: 'Beyond the Horizon', desc: 'Unlock a second region in the Expansion screen.',
    reward: { cash: 3_000_000, xp: 1_000 }, progress: (s) => ratio(s.unlockedRegions.length, 2),
  },
  {
    id: 'reputation_70', title: 'Fan Favourite', desc: 'Reach a reputation of 70.',
    reward: { cash: 3_000_000, xp: 1_500 }, progress: (s) => ratio(s.reputation, 70),
  },
  {
    id: 'pax_1m', title: 'One Million Smiles', desc: 'Carry a total of 1 million passengers.',
    reward: { cash: 8_000_000, xp: 2_500 }, progress: (s) => ratio(s.stats.totalPax, 1_000_000),
  },
  {
    id: 'second_hub', title: 'Hub & Spoke', desc: 'Open a second hub.',
    reward: { cash: 6_000_000, xp: 2_500 }, progress: (s) => ratio(s.hubs.length, 2),
  },
  {
    id: 'profit_year', title: 'Wall Street Darling', desc: 'Earn $50M net profit over twelve months.',
    reward: { cash: 10_000_000, xp: 4_000 }, progress: (s) => ratio(bestYearProfit(s), 50_000_000),
  },
  {
    id: 'fleet_25', title: 'Fleet of 25', desc: 'Operate 25 aircraft.',
    reward: { cash: 12_000_000, xp: 5_000 }, progress: (s) => ratio(activeCount(s), 25), status: (s) => `${activeCount(s)} / 25`,
  },
  {
    id: 'regions_4', title: 'Continental Ambitions', desc: 'Unlock four regions.',
    reward: { cash: 12_000_000, xp: 6_000 }, progress: (s) => ratio(s.unlockedRegions.length, 4),
  },
  {
    id: 'widebody', title: 'Twin Aisles', desc: 'Take delivery of your first widebody aircraft.',
    reward: { cash: 10_000_000, xp: 6_000 }, progress: (s) => (hasBody(s, (id) => isWidebody(AIRCRAFT_BY_ID[id])) ? 1 : 0),
  },
  {
    id: 'long_haul', title: 'Go Long', desc: 'Open an intercontinental route.',
    reward: { cash: 15_000_000, xp: 10_000 },
    progress: (s) => (s.routes.some((r) => AIRPORT_BY_CODE[r.from].continent !== AIRPORT_BY_CODE[r.to].continent) ? 1 : 0),
  },
  {
    id: 'pax_10m', title: 'Ten Million Club', desc: 'Carry a total of 10 million passengers.',
    reward: { cash: 25_000_000, xp: 15_000 }, progress: (s) => ratio(s.stats.totalPax, 10_000_000),
  },
  {
    id: 'fleet_50', title: 'Half a Hundred', desc: 'Operate 50 aircraft.',
    reward: { cash: 25_000_000, xp: 15_000 }, progress: (s) => ratio(activeCount(s), 50), status: (s) => `${activeCount(s)} / 50`,
  },
  {
    id: 'jumbo', title: 'Queen of the Skies', desc: 'Operate an A380 or Boeing 747.',
    reward: { cash: 20_000_000, xp: 15_000 }, progress: (s) => (hasBody(s, (id) => AIRCRAFT_BY_ID[id].body === 'jumbo') ? 1 : 0),
  },
  {
    id: 'continents_3', title: 'Three Continents', desc: 'Fly to airports on three continents.',
    reward: { cash: 30_000_000, xp: 25_000 },
    progress: (s) => ratio(new Set(destinationsServed(s).map((c) => AIRPORT_BY_CODE[c].continent)).size, 3),
  },
  {
    id: 'profit_500m', title: 'Half a Billion', desc: 'Earn $500M net profit over twelve months.',
    reward: { cash: 50_000_000, xp: 40_000 }, progress: (s) => ratio(bestYearProfit(s), 500_000_000),
  },
  {
    id: 'fleet_100', title: 'Centurion', desc: 'Operate 100 aircraft.',
    reward: { cash: 60_000_000, xp: 50_000 }, progress: (s) => ratio(activeCount(s), 100), status: (s) => `${activeCount(s)} / 100`,
  },
  {
    id: 'pax_100m', title: 'A Hundred Million', desc: 'Carry a total of 100 million passengers.',
    reward: { cash: 100_000_000, xp: 100_000 }, progress: (s) => ratio(s.stats.totalPax, 100_000_000),
  },
  {
    id: 'supersonic', title: 'Faster than Sound', desc: 'Operate a supersonic Boom Overture.',
    reward: { cash: 50_000_000, xp: 60_000 }, progress: (s) => (hasBody(s, (id) => AIRCRAFT_BY_ID[id].body === 'supersonic') ? 1 : 0),
  },
  {
    id: 'global', title: 'Global Airline', desc: 'Unlock every continent.',
    reward: { cash: 150_000_000, xp: 150_000 }, progress: (s) => ratio(unlockedContinents(s).length, CONTINENT_ORDER.length),
  },
  {
    id: 'flying_fleet', title: 'Every Wing Earns', desc: 'Have 20 aircraft flying scheduled routes at once.',
    reward: { cash: 8_000_000, xp: 4_000 }, progress: (s) => ratio(flying(s), 20), status: (s) => `${flying(s)} / 20`,
  },
];

export const GOAL_BY_ID = Object.fromEntries(GOALS.map((g) => [g.id, g]));

/** Goals the player is currently working on, in order. */
export function activeGoals(state: GameState, n = 3): Goal[] {
  return GOALS.filter((g) => !state.completedGoals.includes(g.id)).slice(0, n);
}

export function checkGoals(state: GameState) {
  for (const g of GOALS) {
    if (state.completedGoals.includes(g.id)) continue;
    if (g.progress(state) >= 1) {
      state.completedGoals.push(g.id);
      state.cash += g.reward.cash;
      state.finance.current.rev.other += g.reward.cash;
      message(state, 'good', 'goal', `Goal complete: ${g.title}`, `Reward: $${(g.reward.cash / 1e6).toFixed(1)}M and ${g.reward.xp.toLocaleString()} XP.`);
      addXp(state, g.reward.xp);
    }
  }
}
