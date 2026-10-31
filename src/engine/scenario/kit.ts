// v0.12 Scenarios: small helpers the scenario scripts share (scenario/defs.ts). They only use the game's own
// machinery: the offer generator and its drafts, acceptOffer, the world events and the Inbox.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { acceptOffer } from '../contracts/accept';
import { atLocal, finalizeDraft, generateOffer, type Draft, type OfferOpts } from '../contracts/offers';
import { pushMessage } from '../core/messages';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { Archetype, ContractOffer, GameState, LegTemplate, Minute } from '../core/types';

export const cityOf = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

/** The client with this name (seeded by the game), if any. */
export function clientNamed(g: GameState, name: string): string | undefined {
  return Object.values(g.clients).find((c) => c.name === name)?.id;
}

/** An offer of this kind from the generator (a few tries: a draft can come out empty). */
export function offerOf(g: GameState, archetype: Archetype, opts: OfferOpts, tries = 4): ContractOffer | null {
  for (let i = 0; i < tries; i++) {
    const o = generateOffer(g, archetype, { window: false, ...opts });
    if (o) return o;
  }
  return null;
}

/**
 * Signs an offer now with the first aircraft (in the order given, else the fleet's) that passes every check, no
 * client paint; the contract id, or '' when none could take it.
 */
export function signNow(g: GameState, o: ContractOffer | null, prefer: string[] = []): string {
  if (!o) return '';
  const ids = [...new Set([...prefer, ...Object.keys(g.fleet)])];
  for (const id of ids) {
    const r = acceptOffer(g, o.id, [id], { paint: false });
    if (r.ok) return r.data?.contractId ?? '';
  }
  return '';
}

/** The fleet's aircraft ids in creation order. */
export const fleetIds = (g: GameState) => Object.keys(g.fleet);

export interface CharterSpec {
  archetype: Archetype;
  client: string;
  title: string;
  blurb: string;
  /** [from, to, departure (UTC minute), passengers]. */
  legs: [string, string, Minute, number][];
  /** Hours until the offer lapses. */
  expiresH: number;
  mult?: number;
  effects?: Draft['effects'];
  risk?: Draft['risk'];
  pin?: string;
  extraCabin?: number;
}

/** A hand-made charter offer priced by the game (contracts/offers.ts finalize); null when the client is missing or it cannot be flown. */
export function charterOffer(g: GameState, s: CharterSpec): ContractOffer | null {
  const clientId = clientNamed(g, s.client);
  const client = clientId ? g.clients[clientId] : undefined;
  if (!client || s.legs.some(([a, b]) => !AIRPORT_BY_CODE[a] || !AIRPORT_BY_CODE[b])) return null;
  const legs: LegTemplate[] = s.legs.map(([from, to, dep, pax]) => ({ from, to, dep, flightNo: '', pax }));
  const last = legs[legs.length - 1];
  const pax = Math.max(...legs.map((l) => l.pax ?? 0));
  const d: Draft = {
    archetype: s.archetype, client, title: s.title, blurb: s.blurb,
    pattern: { kind: 'legs', legs },
    req: { minSeats: pax, extraCabin: s.extraCabin ?? 0, approvals: [] },
    start: legs[0].dep, end: last.dep + blockMinutes('a320ceo', last.from, last.to) + 6 * 60,
    expiresIn: Math.max(90, Math.min(s.expiresH * 60, legs[0].dep - g.now - 6 * 60)),
    effects: s.effects ?? {}, risk: s.risk ?? { disruption: 0.2, politics: 0, permit: 0 },
    pin: s.pin ?? legs[0].to,
    ...(s.mult ? { mult: s.mult } : {}),
  };
  const o = finalizeDraft(g, d);
  // v0.12.1 a scenario's hand-made job is one-off: no repeat business from it (contracts/missions.ts rollRepeat).
  if (o && g.scen) (g.scen.mem ??= {})[`oneOff:${o.id}`] = 1;
  return o;
}

/** A departure at a local time on the day `days` after today (the scenario's clock). */
export function localDep(g: GameState, code: string, days: number, localMin: number): Minute {
  return atLocal(code, Math.floor(g.now / DAY) * DAY + days * DAY + 12 * 60, localMin);
}

/** An Inbox note from the scenario (goal category). */
export function note(g: GameState, title: string, body: string, tone: 'info' | 'warn' | 'good' | 'bad' = 'info'): void {
  pushMessage(g, { tone, cat: 'goal', topic: 'scenario', title, body });
}

/** Seats of the biggest aircraft we fly (a load never bigger than that). */
export function maxSeats(g: GameState): number {
  return Math.max(0, ...Object.values(g.fleet).map((a) => a.cabin.total || ACMI_TYPES[a.typeId]?.cabins[0].y || 0));
}

/** Signs the first of up to `tries` offers from `make` that an aircraft (in `prefer` order) can take; the others are withdrawn. */
export function signFirst(g: GameState, make: () => ContractOffer | null, prefer: string[] = [], tries = 6): string {
  for (let i = 0; i < tries; i++) {
    const o = make();
    if (!o) continue;
    const id = signNow(g, o, prefer);
    if (id) return id;
    delete g.offers[o.id];
  }
  return '';
}
