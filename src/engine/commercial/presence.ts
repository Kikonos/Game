// v0.14 market presence (the player: "to break into exciting markets, I can just choose to attend different trade
// fairs in different continents"). How well known we are in each market of the world (data/markets.ts), 0–100.
// Ordinary market offers come mostly from markets where we are known, weighted by presence, with a small trickle from
// everywhere else (contracts/offers.ts nearClient). The home market starts known (from the base country), its
// continent a little. Presence grows from a trade fair held there (a big step), a client visit, the jobs we fly for
// its clients and satisfied clients there; it fades slowly without activity (a half-life of months), never below the
// home floor at home. Every gain is saturating: each point is harder to win near 100.
// Saved in g.com.presence (optional: an older save is seeded on load from its clients, contracts and flights).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { MARKET_BY_ID, MARKET_IDS, MARKETS, marketOfCountry, type MarketId } from '../../data/markets';
import { DAY, toDate } from '../core/time';
import type { Archetype, Client, GameState } from '../core/types';
import type { PresenceState } from './types';

export const PRESENCE = {
  /** New company: the home market, the rest of its continent. */
  home: 55,
  continent: 18,
  /** The home market never fades below this. */
  homeFloor: 25,
  /** Half-life of presence without activity (days). */
  halfLifeDays: 180,
  /** A fair: its own market (the first listed), the others it lists, every market for a global one (Routes World). */
  fair: 30,
  fairOther: 14,
  fairGlobal: 6,
  /** A client visit: the client's market. */
  visit: 8,
  /** Each day of a contract under way: its client's market. */
  flyPerDay: 0.25,
  /** Each day per satisfied client (relation 20+ and a job flown): × relation / 100. */
  satisfiedPerDay: 0.05,
  /** Offer weight of a market: trickle + presence / 100 (× its season). */
  trickle: 0.06,
  /** Old saves: per client with jobs (× its level), per contract signed or under way, capped. */
  seedJob: 3,
  seedContract: 6,
  seedCap: 70,
};

/** The home market (the base's country). Pure. */
export const homeMarket = (g: GameState): MarketId => marketOfCountry(AIRPORT_BY_CODE[g.company.homeBase]?.country ?? 'PT');

/** A client's market. Pure. */
export const clientMarket = (c: Pick<Client, 'country'>): MarketId => marketOfCountry(c.country);

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const dayOf = (t: number) => Math.floor(t / DAY);

/** A fresh record: the home market known, its continent a little, the rest unknown. Pure. */
export function freshPresence(g: GameState): PresenceState {
  const home = homeMarket(g);
  const cont = MARKET_BY_ID[home].continent;
  const m: PresenceState['m'] = {};
  for (const x of MARKETS) m[x.id] = x.id === home ? PRESENCE.home : x.continent === cont ? PRESENCE.continent : 0;
  return { m, day: dayOf(g.now) };
}

/**
 * The record (g.com.presence), seeded on first use: a new game from its base; an older save also from its history
 * (clients we have flown for, by level; contracts signed or under way), so the markets it already works in keep their
 * offers.
 */
export function presence(g: GameState): PresenceState {
  const c = (g.com ??= { tenders: [], trips: [], crises: [] });
  if (c.presence) return c.presence;
  const p = freshPresence(g);
  const lv: Record<string, number> = { unhappy: 0.5, new: 1, known: 1.5, trusted: 2, partner: 2.5 };
  const add = (id: MarketId, v: number) => {
    const cur = p.m[id] ?? 0;
    p.m[id] = Math.max(cur, Math.min(PRESENCE.seedCap, cur + v * (1 - cur / 100)));
  };
  for (const cl of Object.values(g.clients)) {
    if (cl.rivalId || !(cl.jobs ?? 0)) continue;
    add(clientMarket(cl), PRESENCE.seedJob * Math.min(6, cl.jobs ?? 0) * (lv[cl.level ?? 'new'] ?? 1));
  }
  for (const k of Object.values(g.contracts)) {
    if (k.status !== 'signed' && k.status !== 'active') continue;
    const cl = g.clients[k.clientId];
    if (cl) add(clientMarket(cl), PRESENCE.seedContract);
  }
  for (const id of MARKET_IDS) p.m[id] = Math.round((p.m[id] ?? 0) * 10) / 10;
  c.presence = p;
  return p;
}

/** Load: an older save is seeded now (SAVE_VERSION stays 1). */
export function loadPresence(g: GameState): void {
  presence(g);
}

/** Presence in a market, 0–100. */
export const presenceIn = (g: GameState, id: MarketId): number => presence(g).m[id] ?? 0;

/** A saturating step up (each point harder near 100); the gain. */
export function bumpPresence(g: GameState, id: MarketId, v: number): number {
  const p = presence(g);
  const cur = p.m[id] ?? 0;
  const next = clamp(cur + v * (1 - cur / 100));
  p.m[id] = Math.round(next * 10) / 10;
  return p.m[id]! - cur;
}

/** A fair attended: its own market a big step, the others it lists half, every market a little for a global one. */
export function fairPresence(g: GameState, markets: MarketId[], global: boolean, skill: number): { id: MarketId; gain: number }[] {
  const f = 0.8 + 0.4 * skill;
  const out: { id: MarketId; gain: number }[] = [];
  if (global) for (const id of MARKET_IDS) if (!markets.includes(id)) out.push({ id, gain: bumpPresence(g, id, PRESENCE.fairGlobal * f) });
  markets.forEach((id, i) => out.push({ id, gain: bumpPresence(g, id, (i === 0 ? PRESENCE.fair : PRESENCE.fairOther) * f) }));
  return out.filter((x) => x.gain > 0.05);
}

/**
 * Daily: the jobs under way and satisfied clients add to their markets; everything fades towards zero (the home
 * market towards its floor) with the half-life. Catches up whole days missed (a long skip runs once a day anyway).
 */
export function dailyPresence(g: GameState): void {
  const p = presence(g);
  const today = dayOf(g.now);
  const days = Math.max(0, Math.min(60, today - p.day));
  if (!days) return;
  p.day = today;
  const gain: Partial<Record<MarketId, number>> = {};
  const add = (id: MarketId, v: number) => (gain[id] = (gain[id] ?? 0) + v);
  for (const k of Object.values(g.contracts)) {
    if (k.status !== 'active') continue;
    const cl = g.clients[k.clientId];
    if (cl) add(clientMarket(cl), PRESENCE.flyPerDay);
  }
  for (const cl of Object.values(g.clients)) {
    if (cl.rivalId || cl.ceased !== undefined || cl.relation < 20 || !(cl.jobs ?? 0)) continue;
    add(clientMarket(cl), (PRESENCE.satisfiedPerDay * cl.relation) / 100);
  }
  const home = homeMarket(g);
  const keep = Math.pow(0.5, days / PRESENCE.halfLifeDays);
  for (const id of MARKET_IDS) {
    const floor = id === home ? PRESENCE.homeFloor : 0;
    let v = p.m[id] ?? 0;
    v = v > floor ? floor + (v - floor) * keep : v;
    const add1 = (gain[id] ?? 0) * days;
    v = clamp(v + add1 * (1 - v / 100));
    p.m[id] = Math.round(v * 100) / 100;
  }
}

/** A market's month factor (its demand calendar). Pure. */
export const seasonOf = (id: MarketId, t: number): number => MARKET_BY_ID[id].season[toDate(t).getUTCMonth()] ?? 1;

/** How much an ordinary offer leans to a client of this country: trickle + presence / 100, × its market's season. */
export function presenceWeight(g: GameState, country: string): number {
  const id = marketOfCountry(country);
  return (PRESENCE.trickle + presenceIn(g, id) / 100) * seasonOf(id, g.now);
}

/**
 * The markets' lean on the kinds of work (data/markets.ts tilt): each archetype × the presence-weighted mean of the
 * markets' tilts (1 where a market has none). Pure.
 */
export function marketTilt(g: GameState): (a: Archetype) => number {
  const w = MARKETS.map((m) => ({ m, w: (PRESENCE.trickle + presenceIn(g, m.id) / 100) * seasonOf(m.id, g.now) }));
  const sum = w.reduce((s, x) => s + x.w, 0) || 1;
  return (a) => w.reduce((s, x) => s + (x.w / sum) * (x.m.tilt?.[a] ?? 1), 0);
}

// ---------- view ----------

export interface PresenceRow {
  id: MarketId;
  name: string;
  short: string;
  value: number;
  home: boolean;
  /** Demand now: 'Peak season', 'Quiet season' or ''. */
  season: string;
  demand: string;
  /** Share of the ordinary offers it would send now (0–1). */
  share: number;
}

/** Every market, the home one first then by presence (Contracts › Markets). Pure but for seeding. */
export function presenceView(g: GameState): PresenceRow[] {
  const home = homeMarket(g);
  const ws = MARKETS.map((m) => (PRESENCE.trickle + presenceIn(g, m.id) / 100) * seasonOf(m.id, g.now));
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  return MARKETS.map((m, i) => {
    const s = seasonOf(m.id, g.now);
    return { id: m.id, name: m.name, short: m.short, value: presenceIn(g, m.id), home: m.id === home, season: s >= 1.2 ? 'Peak season' : s <= 0.8 ? 'Quiet season' : '', demand: m.demand, share: ws[i] / sum };
  }).sort((a, b) => Number(b.home) - Number(a.home) || b.value - a.value || a.name.localeCompare(b.name));
}

/** A plain word for a presence level. Pure. */
export const presenceWord = (v: number): string => (v >= 70 ? 'Well known' : v >= 45 ? 'Known' : v >= 20 ? 'Heard of' : v >= 5 ? 'Barely known' : 'Unknown');
