// New game: the "Startup" scenario (BRIEF v0.5) — two A320ceo at a European base, one owned and
// older, one dry-leased in, ~5 crew sets per aircraft, starting cash. DESIGN.md §2.3.

import { ACMI_TYPES, type CabinPreset } from '../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../data/airports';
import { COUNTRIES } from '../data/countries';
import { DEFAULT_HOME_BASE, HOME_BASES } from '../data/naming';
import { BAL } from './core/balance';
import { nextId } from './core/entities';
import { pushMessage } from './core/messages';
import { int } from './core/rng';
import { START, fromUTC, monthKey } from './core/time';
import type { Aircraft, Cabin, GameState, Livery, Minute, Role } from './core/types';
import { normaliseLivery } from './ops/paint';
import { makeCrewMember } from './crew/generate';
import { GOALS } from './ops/goals';
import { newStatement } from './ops/finance';
import { initCore } from './sim';

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

function emptyState(o: NewGameOptions, seed: number, now: Minute): GameState {
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
      cash: BAL.startCash,
      reputation: { ...BAL.startReputation },
      approvals: [],
      pendingApprovals: [],
      policies: { extraCabin: 0, hotelTier: 4, perDiemPct: 100, rotationWeeks: 5, autoRoster: true, autoMaintenance: true, allowTight: false, autoDeadhead: true },
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
    finance: { current: newStatement(monthKey(now), BAL.startCash), history: [], receivables: [] },
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
  return { ...o, name, code, icao, callsign, base };
}

export const isHomeBase = (code: string): boolean => (HOME_BASES as readonly string[]).includes(code);

export function createGame(opts: NewGameOptions): GameState {
  const o = normaliseOptions(opts);
  const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0;
  const now = o.start ?? START;
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
