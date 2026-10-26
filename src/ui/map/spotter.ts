// v0.12 Visual A: spotter mode, pure parts. Which aircraft to watch next (a fixed round by registration, so every
// airborne aircraft gets its turn and none is skipped), the next departure when nothing flies, and a plausible
// altitude and ground speed for the panel: taxi out, climb, cruise at a semicircular flight level (east odd, west
// even), step climbs on long legs, descent, taxi in. A view only: nothing here touches the game.

import { ACMI_TYPES } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightTimes } from '../../engine/core/query';
import type { Aircraft, Flight, GameState, Minute } from '../../engine/core/types';
import { hashUnit } from '../../engine/core/util';
import { onMap } from './mapLogic';

/** Real seconds a spotted aircraft stays before the next one. */
export const SPOT_SECONDS = 60;

/** Our airborne aircraft, in the spotter's order (registration, then id). Pure. */
export function spotList(g: GameState): Aircraft[] {
  return Object.values(g.fleet)
    .filter((ac) => !!ac.flightId && g.flights[ac.flightId]?.status === 'enroute' && onMap(ac))
    .sort((a, b) => (a.reg < b.reg ? -1 : a.reg > b.reg ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const keyOf = (ac: Pick<Aircraft, 'reg' | 'id'>) => `${ac.reg}\u0000${ac.id}`;

/**
 * The aircraft to watch after `cur` (an id; it may have landed since): the next airborne one in registration
 * order after it, wrapping round. Deterministic; going round from any start visits every airborne aircraft once
 * before any comes back. Null when nothing is airborne. Pure.
 */
export function spotNext(g: GameState, cur?: string | null): string | null {
  const list = spotList(g);
  if (!list.length) return null;
  const c = cur ? g.fleet[cur] : undefined;
  if (!c) return list[0].id;
  const k = keyOf(c);
  return (list.find((ac) => keyOf(ac) > k) ?? list[0]).id;
}

/** The next departure of our fleet (when nothing flies): the earliest scheduled leg of an aircraft on the map. Pure. */
export function nextDeparture(g: GameState, t: Minute): { flight: Flight; ac: Aircraft } | null {
  let best: { flight: Flight; ac: Aircraft } | null = null;
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || f.kind === 'deadhead') continue;
    const dep = f.std + f.delay;
    if (dep < t) continue;
    const ac = g.fleet[f.aircraftId];
    if (!ac || !onMap(ac) || ac.flightId) continue;
    if (!best || dep < best.flight.std + best.flight.delay || (dep === best.flight.std + best.flight.delay && f.id < best.flight.id)) best = { flight: f, ac };
  }
  return best;
}

export type SpotPhase = 'taxiOut' | 'climb' | 'cruise' | 'descent' | 'taxiIn';

export interface SpotProfile {
  phase: SpotPhase;
  /** Feet (rounded to 100; a flight level exactly in cruise). */
  altFt: number;
  /** Ground speed, knots. */
  gsKt: number;
  /** Share of the block time flown, 0–1. */
  progress: number;
  /** Planned cruise level (e.g. 370). */
  fl: number;
}

/** Initial great-circle bearing (deg, 0 = north) from a to b. */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * R) * Math.cos(b.lat * R);
  const x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lon - a.lon) * R);
  return ((Math.atan2(y, x) / R) % 360 + 360) % 360;
}

/** Highest usual cruise level per type family (initial level before any step climb), hundreds of feet. */
const TOP_FL: Record<string, number> = { A320: 370, B737: 370, 'B757/767': 380, 'A330/340': 370, B777: 350, B787: 390, A350: 390, A380: 370, B747: 350 };
/** The A340's four engines climb slowly: it cruises lower. */
const TOP_FL_TYPE: Record<string, number> = { a342: 350, a343: 350, a345: 350, a346: 350, b752: 390, b753: 370, b788: 410, a35u: 400 };

interface Shape {
  off: number;
  block: number;
  taxiOut: number;
  air: number;
  tC: number;
  tD: number;
  /** Top of climb (ft) and the planned level. */
  top: number;
  fl: number;
  cruiseGs: number;
  /** Step climbs on long legs. */
  long: boolean;
}

/** The leg's profile shape (times in minutes from off-blocks). Pure. */
function shapeOf(f: Flight, typeId: string): Shape {
  const { off, on } = flightTimes(f);
  const block = Math.max(10, on - off);
  const taxiOut = Math.min(14, Math.max(6, block * 0.06));
  const taxiIn = Math.min(8, Math.max(4, block * 0.04));
  const air = Math.max(4, block - taxiOut - taxiIn);
  const A = AIRPORT_BY_CODE[f.from];
  const B = AIRPORT_BY_CODE[f.div?.to0 ?? f.to] ?? AIRPORT_BY_CODE[f.to];
  const type = ACMI_TYPES[typeId];
  const tas = type?.cruiseKt ?? 450;
  const east = A && B ? bearing(A, B) < 180 : true;
  // Highest level for the type, then lower on short legs (≈ 6 × airborne minutes, a rule of thumb), on the rule.
  const typeTop = TOP_FL_TYPE[typeId] ?? (type ? TOP_FL[type.family] : 370) ?? 370;
  let fl = Math.floor(Math.min(typeTop, Math.max(110, Math.round(air * 6.2))) / 10) * 10;
  if (fl >= 290) {
    // Semicircular (RVSM): eastbound 290, 310, 330…; westbound 300, 320, 340…
    if (east && (fl / 10) % 2 === 0) fl -= 10;
    if (!east && (fl / 10) % 2 === 1) fl -= 10;
  } else {
    // Below 290: east odd thousands, west even.
    const th = Math.round(fl / 10);
    fl = (east ? (th % 2 ? th : th - 1) : th % 2 ? th - 1 : th) * 10;
  }
  const climb = Math.min(26, Math.max(10, fl * 0.07));
  const desc = Math.min(30, Math.max(12, fl * 0.075));
  const squeeze = Math.min(1, (air * 0.9) / (climb + desc));
  // Jet stream, as the block times assume (perf.ts windFactor): mid-latitude legs only.
  const midLat = !!A && !!B && (Math.abs(A.lat) >= 25 || Math.abs(B.lat) >= 25);
  let dLon = A && B ? B.lon - A.lon : 0;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const jet = midLat && Math.abs(dLon) >= 15 ? (dLon < 0 ? -0.065 : 0.05) : 0;
  const gust = (hashUnit(`spot:${f.id}`) - 0.5) * 16;
  return { off, block, taxiOut, air, tC: climb * squeeze, tD: desc * squeeze, top: fl * 100 * Math.min(1, squeeze * 1.05), fl, cruiseGs: tas * (1 + jet) + gust, long: air > 7 * 60 && squeeze === 1 };
}

/**
 * A believable vertical profile for a leg at t: what a flight-tracking site shows. Short legs cruise lower; the
 * level follows the semicircular rule (east odd, west even); legs over seven hours step up 2,000 ft every three
 * hours. Ground speed: the type's cruise speed with the jet stream (westbound slower, as the game's block times).
 */
export function flightProfile(f: Flight, typeId: string, t: number): SpotProfile {
  const s = shapeOf(f, typeId);
  const el = Math.min(s.block, Math.max(0, t - s.off));
  const progress = el / s.block;
  const { top, fl, cruiseGs, tC, tD, air } = s;
  const r100 = (x: number) => Math.max(0, Math.round(x / 100) * 100);
  const a = el - s.taxiOut;
  if (a < 0) return { phase: 'taxiOut', altFt: 0, gsKt: el < 2 ? 0 : 15, progress, fl };
  if (a > air) return { phase: 'taxiIn', altFt: 0, gsKt: el >= s.block - 1 ? 0 : 14, progress, fl };
  if (a < tC) {
    const alt = top * (1 - (1 - a / tC) ** 1.7);
    return { phase: 'climb', altFt: r100(alt), gsKt: Math.round(150 + (cruiseGs - 150) * (alt / Math.max(1, top)) ** 0.8), progress, fl };
  }
  if (a > air - tD) {
    const alt = top * (1 - (a - (air - tD)) / tD) ** 1.15;
    return { phase: 'descent', altFt: r100(alt), gsKt: Math.round(140 + (cruiseGs - 140) * (alt / Math.max(1, top)) ** 0.7), progress, fl };
  }
  // Cruise, with step climbs on long legs (2,000 ft every 3 h after the first 2 h, as the aircraft burns fuel off).
  const steps = s.long ? Math.min(2, Math.max(0, Math.floor((a - tC - 120) / 180) + 1)) : 0;
  return { phase: 'cruise', altFt: Math.round(top / 100) * 100 + steps * 2000, gsKt: Math.round(cruiseGs), progress, fl };
}

/** Game minutes [from, to) when the leg is high enough for contrails (≥ CONTRAIL_FT); null when it never is. Pure. */
export function contrailWindow(f: Flight, typeId: string): [number, number] | null {
  const s = shapeOf(f, typeId);
  if (s.top < CONTRAIL_FT) return null;
  const q = 1 - CONTRAIL_FT / s.top;
  // Climb: top·(1 − (1 − x)^1.7) reaches it at x = 1 − q^(1/1.7); descent: top·(1 − x)^1.15 leaves it at x = 1 − (1 − q)^(1/1.15).
  const up = s.tC * (1 - q ** (1 / 1.7));
  const down = s.air - s.tD + s.tD * (1 - (1 - q) ** (1 / 1.15));
  return [s.off + s.taxiOut + up, s.off + s.taxiOut + down];
}

/** Contrails only in the cold air up high (ft). */
export const CONTRAIL_FT = 26_000;
