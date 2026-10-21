// Test helpers for the contracts module (B1). Not used by the game.

import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { DAY } from '../core/time';
import type { Aircraft, ContractOffer, GameState, Minute } from '../core/types';
import { generateOffer, type OfferOpts } from './offers';
import { cabinFrom } from '../newGame';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { nextId } from '../core/entities';

export const newGame = (seed = 7, base = 'LIS'): GameState =>
  createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base, seed });

/** Advances to t through every auto-pause (tests honour all reasons). */
export function run(g: GameState, t: Minute): void {
  for (let i = 0; i < 100_000 && g.now < t && !g.gameOver; i++) advanceTo(g, t);
}

export const leased = (g: GameState): Aircraft => Object.values(g.fleet).find((a) => a.ownership.kind === 'dryLeaseIn')!;
export const owned = (g: GameState): Aircraft => Object.values(g.fleet).find((a) => a.ownership.kind === 'owned')!;

/** An offer with fit-blocking extras (layout, family) removed so the A320s qualify. */
export function offer(g: GameState, archetype: ContractOffer['archetype'], opts: OfferOpts = {}): ContractOffer {
  // Generators keep one open request per client and archetype: drop earlier open test offers of this kind.
  for (const x of Object.values(g.offers)) if (x.archetype === archetype && x.status === 'open') delete g.offers[x.id];
  // v0.5.1: no client paint unless the test asks for it (opts.paint).
  const o = generateOffer(g, archetype, { wide: false, window: false, paint: false, ...opts });
  if (!o) throw new Error(`no ${archetype} offer`);
  o.requirements.layout = undefined;
  // v0.7 cabin rules (layouts, premium seats) off too.
  delete o.requirements.layouts;
  delete o.requirements.minPremium;
  o.requirements.families = undefined;
  o.requirements.minSeats = Math.min(o.requirements.minSeats, 170);
  o.expires = Math.max(o.expires, g.now + DAY);
  return o;
}

/** HAM season base flying HAM–PMI only (waves 06:00 / 12:30 / 19:00 local on an A320). */
export const hamBase = (g: GameState, start: Minute, days = 60, waves = 3) =>
  offer(g, 'seasonBase', { airport: 'HAM', dests: ['PMI'], waves, start, days });

/** Adds an aircraft of another type at home base (tests). */
export function addAircraft(g: GameState, typeId: string): Aircraft {
  const base = Object.values(g.fleet)[0];
  const id = nextId(g, 'a');
  const t = ACMI_TYPES[typeId];
  const ac: Aircraft = { ...structuredClone(base), id, reg: `TEST${id}`, typeId, cabin: cabinFrom(t.cabins[0]), ownership: { kind: 'owned', bookValue: 1 }, at: g.company.homeBase, flightId: null, status: 'available' };
  ac.maint = { ...ac.maint, fhSinceA: 0, lastA: g.now, fhSinceC: 0, lastC: g.now };
  g.fleet[id] = ac;
  return ac;
}

/** A charter offer flying exactly these legs (from, to, departure UTC); price and client from a generated ad hoc. */
export function legsOffer(g: GameState, legs: [string, string, Minute][], minSeats = 150): ContractOffer {
  const o = offer(g, 'adhoc', { start: legs[0][2] });
  o.pattern = { kind: 'legs', legs: legs.map(([from, to, dep]) => ({ from, to, dep, flightNo: '', pax: minSeats })) };
  o.requirements.minSeats = minSeats;
  o.requirements.noTechStops = undefined;
  o.start = legs[0][2];
  o.end = legs[legs.length - 1][2] + 12 * 60;
  o.expires = Math.min(o.expires, o.start - 60);
  return o;
}
