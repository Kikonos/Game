// New game: the "Startup" scenario (BRIEF v0.5) — two A320ceo at a European base, one owned and
// older, one dry-leased in, ~5 crew sets per aircraft, starting cash. DESIGN.md §2.3.

import { ACMI_TYPES, type CabinPreset } from '../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../data/airports';
import { COUNTRIES } from '../data/countries';
import { DEFAULT_HOME_BASE, HOME_BASES } from '../data/naming';
import { SETUP_BY_ID, type SetupAircraft, type SetupId, type StartSetup } from '../data/setups';
import { BAL } from './core/balance';
import { nextId } from './core/entities';
import { pushMessage } from './core/messages';
import { int } from './core/rng';
import { DAY, START, fromUTC, monthKey, yearOf } from './core/time';
import type { Aircraft, Cabin, GameState, Livery, Minute, Role } from './core/types';
import { normaliseLivery } from './ops/paint';
import { makeCrewMember } from './crew/generate';
import { GOALS } from './ops/goals';
import { newStatement } from './ops/finance';
import { initCore } from './sim';
import { crewPlan } from './crew/sets';

export const SAVE_VERSION = 1;

export interface NewGameOptions {
  /** Company name (trimmed; a blank name falls back to "New Charter"). */
  name: string;
  /** Two-character IATA-style code (letters/digits, upper-cased). */
  code: string;
  icao?: string;
  callsign?: string;
  ceo?: string;
  livery: Livery;
  /** Home base (HOME_BASES; any known airport works, an unknown code falls back to LIS). */
  base: string;
  seed?: number;
  start?: Minute;
  /** v0.12 start setup (data/setups.ts); absent or 'classic' = the two-A320 start. */
  setup?: SetupId;
  /** v0.12 Scenarios: a fleet, crew and cash of its own (instead of a setup), a hook before the modules start, no welcome line. */
  custom?: Pick<StartSetup, 'fleet' | 'sets' | 'cash'>;
  beforeInit?: (g: GameState) => void;
  quiet?: boolean;
}

export function cabinFrom(p: CabinPreset): Cabin {
  return { j: p.j, w: p.w, y: p.y, total: p.j + p.w + p.y, label: p.label, layout: p.layout };
}

/** Registrations like 'CS-TQA': prefix + 3 letters (2 letters after 1-char prefixes like 'G-' get 4). */
function registration(g: GameState, prefix: string, used: Set<string>): string {
  const n = prefix.length <= 2 ? 4 : 3;
  for (;;) {
    let s = prefix === 'CS-' ? 'T' : '';
    while (s.length < n) s += String.fromCharCode(65 + int(g, 0, 25));
    const reg = prefix + s;
    if (!used.has(reg)) {
      used.add(reg);
      return reg;
    }
  }
}

function emptyState(o: NewGameOptions, seed: number, now: Minute, cash: number = BAL.startCash): GameState {
  const ap = AIRPORT_BY_CODE[o.base];
  return {
    version: SAVE_VERSION,
    seed,
    rng: seed,
    seq: 0,
    now,
    started: now,
    scenario: 'startup',
    company: {
      name: o.name,
      code: o.code,
      icao: o.icao ?? (o.code + (o.name.replace(/[^A-Za-z]/g, '')[2] ?? 'X')).toUpperCase().slice(0, 3),
      callsign: o.callsign ?? o.name.split(' ')[0].toUpperCase(),
      ceo: o.ceo ?? 'You',
      livery: normaliseLivery(o.livery),
      homeBase: o.base,
      regPrefix: COUNTRIES[ap.country]?.reg ?? 'CS-',
      cash,
      reputation: { ...BAL.startReputation },
      approvals: [],
      pendingApprovals: [],
      policies: { extraCabin: 0, hotelTier: 4, perDiemPct: 100, rotationWeeks: 5, autoRoster: true, autoMaintenance: true, allowTight: false, autoDeadhead: true, buyBack: 'auto' },
      departments: [],
      nextFlightNo: 101,
    },
    fleet: {},
    crew: {},
    flights: {},
    duties: {},
    pairings: {},
    deployments: {},
    clients: {},
    offers: {},
    contracts: {},
    maintenance: {},
    hires: [],
    training: [],
    classes: {},
    messages: [],
    decisions: [],
    finance: { current: newStatement(monthKey(now), cash), history: [], receivables: [] },
    market: { aircraft: [], fuelPrice: BAL.fuelPrice, narrowIndex: 1, wideIndex: 1 },
    rivals: [],
    goals: GOALS.map((x) => ({ id: x.id, done: null })),
    stats: { blockMin: 0, legs: 0, onTime: 0, delayed: 0, cancelled: 0, contractsDone: 0, bestMonthProfit: 0 },
    queue: [],
    gameOver: null,
  };
}

/** Starting roster: 10 A320 sets of 1 CPT + 1 FO + 1 purser (PUR, the SCCM) + 3 CC (180Y). */
const STARTUP_CREW: [Role, number][] = [['CPT', 10], ['FO', 10], ['PUR', 10], ['CC', 30]];

/** Normalised options: trimmed name, 2-char code, a known base. */
export function normaliseOptions(o: NewGameOptions): NewGameOptions {
  const name = o.name.trim().replace(/\s+/g, ' ').slice(0, 40) || 'New Charter';
  const code = (o.code.toUpperCase().replace(/[^A-Z0-9]/g, '') + 'XX').slice(0, 2);
  const icao = o.icao ? o.icao.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || undefined : undefined;
  const callsign = o.callsign ? o.callsign.toUpperCase().trim().slice(0, 16) || undefined : undefined;
  const base = AIRPORT_BY_CODE[o.base] ? o.base : DEFAULT_HOME_BASE;
  const setup = o.setup && SETUP_BY_ID[o.setup] ? o.setup : undefined;
  return { ...o, name, code, icao, callsign, base, setup };
}

export const isHomeBase = (code: string): boolean => (HOME_BASES as readonly string[]).includes(code);

export function createGame(opts: NewGameOptions): GameState {
  const o = normaliseOptions(opts);
  const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0;
  const now = o.start ?? START;
  // v0.12 another start setup: its own fleet, crew and cash (the classic start below stays exactly as it was).
  if (o.custom) return createSetupGame(o, o.custom, seed, now);
  if (o.setup && o.setup !== 'classic') return createSetupGame(o, SETUP_BY_ID[o.setup], seed, now);
  const g = emptyState(o, seed, now);
  const t = ACMI_TYPES.a320ceo;
  const used = new Set<string>();
  const ac = (owned: boolean): Aircraft => {
    const built = owned ? 2006 : 2013;
    const age = 2027 - built;
    const hours = age * 2_550 + int(g, -1_500, 1_500);
    return {
      id: nextId(g, 'a'),
      reg: registration(g, g.company.regPrefix, used),
      typeId: t.id,
      ownership: owned
        ? { kind: 'owned', bookValue: 9_500_000 }
        : { kind: 'dryLeaseIn', lessor: 'AerCap', rentPerMonth: 228_000, reservesPerFH: 380, leaseStart: fromUTC(2026, 11, 1), leaseEnd: fromUTC(2031, 3, 1) },
      builtYear: built,
      hours,
      cycles: Math.round(hours / 1.7),
      maint: {
        fhSinceA: owned ? 520 : 140,
        lastA: now - (owned ? 70 : 20) * 1440,
        fhSinceC: owned ? 3_100 : 900,
        lastC: now - (owned ? 470 : 150) * 1440,
        deferred: owned ? 0.12 : 0.03,
      },
      cabin: cabinFrom(t.cabins[0]),
      etops: 0,
      at: o.base,
      flightId: null,
      status: 'available',
      maintId: null,
      deliveredAt: now,
    };
  };
  for (const a of [ac(true), ac(false)]) g.fleet[a.id] = a;
  for (const [role, n] of STARTUP_CREW) {
    for (let i = 0; i < n; i++) {
      const c = makeCrewMember(g, role, t.family, o.base);
      c.hired = now - int(g, 60, 1_400) * 1440;
      g.crew[c.id] = c;
    }
  }
  initCore(g);
  pushMessage(g, {
    tone: 'info',
    cat: 'company',
    title: `Welcome to ${o.name}`,
    body: `Two A320s at ${AIRPORT_BY_CODE[o.base].city} (${o.base}), ${Object.keys(g.crew).length} crew and $${(BAL.startCash / 1e6).toFixed(1)}M in the bank. Summer is coming: find work for both aircraft before the rent is due.`,
  });
  return g;
}

// ---------- v0.12 start setups ----------

/** Market age factor (ops/market.ts makeOffer): −2 %/year past 12, −4 %/year past 18 (0.55–1.15). Pure. */
const ageAdj = (age: number) => Math.min(1.15, Math.max(0.55, 1 - (age - 12) * 0.02 - Math.max(0, age - 18) * 0.04));

/**
 * v0.12 one start aircraft from a setup line: the type's own rent, reserves, value and check intervals (data/acmiTypes),
 * priced by age as the market prices them; hours as the classic start (about 2,550 a year). Wear: 'mid' are the
 * classic start's counters (owned or leased), 'fresh' just out of its checks, 'worn' A- and C-check due within weeks.
 */
export function startAircraft(g: GameState, s: SetupAircraft, base: string, used: Set<string>, now: Minute): Aircraft {
  const t = ACMI_TYPES[s.typeId];
  const age = Math.max(0, yearOf(now) - s.built);
  const wide = t.body === 'wide';
  const hours = Math.max(800, age * (wide ? 4_200 : 2_550) + int(g, -1_500, 1_500));
  const adj = ageAdj(age);
  const cDays = t.cCheckMonths * 30.44;
  const maint = s.wear === 'fresh'
    ? { fhSinceA: 60, lastA: now - 12 * DAY, fhSinceC: 400, lastC: now - 70 * DAY, deferred: 0.02 }
    : s.wear === 'worn'
      ? { fhSinceA: t.aCheckFH - 110, lastA: now - 95 * DAY, fhSinceC: Math.round(cDays * 7.3) - 300, lastC: now - Math.round(cDays - 75) * DAY, deferred: 0.2 }
      : s.owned
        ? { fhSinceA: 520, lastA: now - 70 * DAY, fhSinceC: 3_100, lastC: now - 470 * DAY, deferred: 0.12 }
        : { fhSinceA: 140, lastA: now - 20 * DAY, fhSinceC: 900, lastC: now - 150 * DAY, deferred: 0.03 };
  const rent = Math.round((t.rentMonth * adj) / 1000) * 1000;
  return {
    id: nextId(g, 'a'),
    reg: registration(g, g.company.regPrefix, used),
    typeId: t.id,
    ownership: s.owned
      ? { kind: 'owned', bookValue: Math.round((t.valueUsed * adj) / 10_000) * 10_000 }
      : { kind: 'dryLeaseIn', lessor: s.lessor ?? 'AerCap', rentPerMonth: rent, reservesPerFH: Math.round((t.maintBH * 0.42) / 10) * 10, leaseStart: now - 120 * DAY, leaseEnd: now + 4 * 365 * DAY },
    builtYear: s.built,
    hours,
    cycles: Math.round(hours / (wide ? t.hPerCycle ?? 6.4 : 1.7)),
    maint,
    cabin: cabinFrom(t.cabins[s.cabin ?? 0] ?? t.cabins[0]),
    // Widebodies come ETOPS-configured as the market delivers them (narrowbodies: none until the approval).
    etops: t.body === 'wide' ? Math.min(180, t.etopsMax) : 0,
    at: base,
    flightId: null,
    status: 'available',
    maintId: null,
    deliveredAt: now,
  };
}

/**
 * v0.12 crew for the fleet in g: per family, `sets` crew sets per aircraft as the Planning view counts a set (crewPlan:
 * pilots, a purser and the cabin crew the cabin needs), rounded up per role. Returns the crew added.
 */
export function startCrew(g: GameState, base: string, sets: number, now: Minute): number {
  let n = 0;
  for (const p of crewPlan(g)) {
    for (const r of p.roles) {
      const count = Math.ceil(r.perSet * p.aircraft * sets - 1e-9);
      for (let i = 0; i < count; i++) {
        const c = makeCrewMember(g, r.role, p.family, base);
        c.hired = now - int(g, 60, 1_400) * 1440;
        g.crew[c.id] = c;
        n++;
      }
    }
  }
  return n;
}

/** '2× A321ceo' / 'an A320ceo and a 737-800' for the welcome line. Pure. */
export function fleetWords(fleet: SetupAircraft[]): string {
  const by = new Map<string, number>();
  for (const a of fleet) by.set(a.typeId, (by.get(a.typeId) ?? 0) + 1);
  return [...by].map(([id, k]) => `${k}× ${ACMI_TYPES[id].short}`).join(' + ');
}

function createSetupGame(o: NewGameOptions, s: Pick<StartSetup, 'fleet' | 'sets' | 'cash'> & { id?: SetupId }, seed: number, now: Minute): GameState {
  const g = emptyState(o, seed, now, s.cash);
  if (s.id) g.setup = s.id;
  const used = new Set<string>();
  for (const line of s.fleet.filter((x) => !x.noCrew)) {
    const a = startAircraft(g, line, o.base, used, now);
    g.fleet[a.id] = a;
  }
  const crew = startCrew(g, o.base, s.sets, now);
  // Scenarios: aircraft that come without crews join after the crew is sized.
  for (const line of s.fleet.filter((x) => x.noCrew)) {
    const a = startAircraft(g, line, o.base, used, now);
    g.fleet[a.id] = a;
  }
  o.beforeInit?.(g);
  initCore(g);
  if (o.quiet) return g;
  pushMessage(g, {
    tone: 'info',
    cat: 'company',
    title: `Welcome to ${o.name}`,
    body: `${fleetWords(s.fleet)} at ${AIRPORT_BY_CODE[o.base].city} (${o.base}), ${crew} crew and $${(s.cash / 1e6).toFixed(1)}M in the bank. ${s.fleet.length === 1 ? 'Find work for the aircraft' : 'Find work for the fleet'} before the ${s.fleet.some((a) => !a.owned) ? 'rent' : 'salaries'} ${s.fleet.some((a) => !a.owned) ? 'is' : 'are'} due.`,
  });
  return g;
}

/**
 * v0.12 the crew a setup starts with, by role (the New Game cards), sized as createGame sizes it: per family `sets`
 * crew sets per aircraft. Pure (a throwaway state).
 */
export function setupCrew(s: Pick<StartSetup, 'fleet' | 'sets'>): { total: number; byRole: Partial<Record<Role, number>> } {
  const g = emptyState({ name: 'x', code: 'XX', livery: { primary: '#000000', secondary: '#ffffff', tail: 'solid' }, base: DEFAULT_HOME_BASE }, 1, START);
  const used = new Set<string>();
  for (const line of s.fleet.filter((x) => !x.noCrew)) {
    const a = startAircraft(g, line, DEFAULT_HOME_BASE, used, START);
    g.fleet[a.id] = a;
  }
  const byRole: Partial<Record<Role, number>> = {};
  let total = 0;
  for (const p of crewPlan(g)) {
    for (const r of p.roles) {
      const n = Math.ceil(r.perSet * p.aircraft * s.sets - 1e-9);
      byRole[r.role] = (byRole[r.role] ?? 0) + n;
      total += n;
    }
  }
  return { total, byRole };
}
