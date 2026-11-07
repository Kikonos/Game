// v0.18 an offer's or contract's shape at a glance: the body it needs (narrowbody / widebody) and how far it flies
// (short-, medium-, long- or ultra-long-haul). Shown as two compact tags on every offer and contract card and in the
// offer dialog, and used by the offer filter (contracts/filter.ts) and the Market's quick chips. Pure.
//
// Body: what the job needs, as feasibility checks it: the client asks for a body (a widebody base, Hajj, Antarctica,
// an A320-size base), only widebody families are named, or no narrowbody cabin seats the load (pricing.isWideJob).
// A contract uses the aircraft actually flying it. A job that names neither is a narrowbody job.
//
// Haul: by the LONGEST revenue sector of the programme (a base: base to its farthest destination), converted to a
// typical block time on a jet averaging 460 kt over the airway routing (+4 %) plus 27 min of taxi, climb and descent
// (core/perf.ts blockMinutes with a generic cruise). Standard airline bands by block time:
//   short-haul       under 3 h      (≈ under 1,130 nm / 2,100 km: Lisbon–Frankfurt, Paris–Rome)
//   medium-haul      3 to 6 h       (≈ 1,130–2,450 nm: Lisbon–Tel Aviv, London–Cairo)
//   long-haul        6 to 12 h      (≈ 2,450–5,100 nm: Frankfurt–New York, Lisbon–São Paulo)
//   ultra-long-haul  12 h and over  (≈ 5,100 nm+: London–Singapore, Dubai–Los Angeles)
// The longest sector decides because it is what the aircraft and crew must manage (range, ETOPS, augmented crew).

import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { distanceNm } from '../core/geo';
import { ROUTE_FACTOR, TAXI_CLIMB_MIN, typeOf } from '../core/perf';
import type { Contract, ContractOffer, Requirements, SchedulePattern } from '../core/types';
import { isWideJob } from './pricing';

export type Body = 'narrow' | 'wide';
export type Haul = 'short' | 'medium' | 'long' | 'ultra';

export const BODIES: Body[] = ['narrow', 'wide'];
export const HAULS: Haul[] = ['short', 'medium', 'long', 'ultra'];
export const BODY_LABEL: Record<Body, string> = { narrow: 'Narrowbody', wide: 'Widebody' };
export const HAUL_LABEL: Record<Haul, string> = { short: 'Short-haul', medium: 'Medium-haul', long: 'Long-haul', ultra: 'Ultra-long-haul' };
/** The band's block time in words (filter hints, tag tips). */
export const HAUL_RANGE: Record<Haul, string> = { short: 'under 3 h', medium: '3 to 6 h', long: '6 to 12 h', ultra: '12 h and over' };

/** The generic cruise behind the haul bands (kt). */
export const HAUL_KT = 460;
/** Upper bounds of the bands in block minutes (short < 180, medium < 360, long < 720, ultra beyond). */
export const HAUL_MIN: Record<Exclude<Haul, 'ultra'>, number> = { short: 180, medium: 360, long: 720 };

/** A typical block time for a sector of `nm` great-circle nautical miles (minutes). Pure. */
export const typicalBlockMin = (nm: number): number => (nm * ROUTE_FACTOR / HAUL_KT) * 60 + TAXI_CLIMB_MIN;

/** The band of a typical block time. Pure. */
export function haulOfMin(min: number): Haul {
  if (min < HAUL_MIN.short) return 'short';
  if (min < HAUL_MIN.medium) return 'medium';
  if (min < HAUL_MIN.long) return 'long';
  return 'ultra';
}

/** The revenue sectors of a programme (a base: out and back to each destination). Pure. */
function sectorsOf(p: SchedulePattern): [string, string][] {
  if (p.kind === 'base') return p.dests.map((d) => [p.base, d]);
  return p.legs.map((l) => [l.from, l.to]);
}

/** Widebody-only families (the 767, A330, 777 ...), from the type list. */
const WIDE_FAMILIES = new Set(ACMI_TYPES_LIST.filter((t) => t.body === 'wide').map((t) => t.family as string));
const NARROW_FAMILIES = new Set(ACMI_TYPES_LIST.filter((t) => t.body === 'narrow').map((t) => t.family as string));

/** The body a job needs (see the header). Pure. */
export function bodyOfReq(req: Pick<Requirements, 'minSeats' | 'body' | 'families'>): Body {
  if (req.body) return req.body;
  const fam = req.families ?? [];
  if (fam.length && fam.every((f) => WIDE_FAMILIES.has(f) && !NARROW_FAMILIES.has(f))) return 'wide';
  return isWideJob(req) ? 'wide' : 'narrow';
}

export interface Shape {
  body: Body;
  /** null: nothing of ours flies it (a dry lease out). */
  haul: Haul | null;
  /** The longest revenue sector, its distance and typical block time. */
  sector: [string, string] | null;
  nm: number;
  blockMin: number;
}

type Shaped = Pick<ContractOffer, 'pattern' | 'requirements' | 'product'>;

/** The shape of an offer or a contract (a contract by the aircraft flying it). Pure; a few haversines. */
export function shapeOf(o: Shaped & Partial<Pick<Contract, 'aircraftIds'>>, fleetTypeOf?: (id: string) => string | undefined): Shape {
  let body = bodyOfReq(o.requirements);
  const typeId = o.aircraftIds?.length && fleetTypeOf ? fleetTypeOf(o.aircraftIds[0]) : undefined;
  if (typeId && typeOf(typeId)) body = typeOf(typeId).body;
  let sector: [string, string] | null = null;
  let nm = 0;
  if (o.product.kind !== 'dry') {
    for (const [a, b] of sectorsOf(o.pattern)) {
      if (a === b) continue;
      const d = distanceNm(a, b);
      if (Number.isFinite(d) && d > nm) {
        nm = d;
        sector = [a, b];
      }
    }
  }
  const blockMin = sector ? typicalBlockMin(nm) : 0;
  return { body, haul: sector ? haulOfMin(blockMin) : null, sector, nm: Math.round(nm), blockMin: Math.round(blockMin) };
}

/** '7:35' block. */
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;

/** The haul tag's tip: 'Longest leg LIS–GRU: 4,290 nm, about 9:50 block (long-haul: 6 to 12 h)'. Pure. */
export function haulTip(s: Shape): string {
  if (!s.haul || !s.sector) return 'Aircraft only: the lessee flies it';
  return `Longest leg ${s.sector[0]}–${s.sector[1]}: ${s.nm.toLocaleString('en-US')} nm, about ${hm(s.blockMin)} block (${HAUL_LABEL[s.haul].toLowerCase()}: ${HAUL_RANGE[s.haul]})`;
}
