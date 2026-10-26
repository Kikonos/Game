// v0.7.1 the one ProblemCard every problem is told with (UPDATE-0.7.1.md §1): types and the pure helpers that build
// its "does it hurt?" line. No engine imports (crew/control.ts and the problems modules both use these).

import type { TermId } from '../../data/glossary';
import { BAL } from '../core/balance';
import type { CrewFix, Minute, ProblemKind, ProblemRef, Ref } from '../core/types';

export type { ProblemKind, ProblemRef };

export interface Hurt {
  /** $ at stake if nothing is done (penalties, compensation, lost revenue, cost). */
  money: number;
  /** Passengers affected. */
  pax: number;
  /** Expected lateness (minutes). */
  delayMin: number;
  /** Revenue legs affected. */
  legs: number;
  /** none: no money, no pax; low: < $10K and < 100 pax; high: otherwise. */
  level: 'none' | 'low' | 'high';
  /** 'Not much: empty flight, ~3 h late, no penalty' / 'Yes: 180 passengers, $42K penalty'. */
  text: string;
  /** ['no cost'] / ['$12K', '180 pax', '2 h late']. */
  badges: string[];
}

export type ModalKind = 'crewControl' | 'duty' | 'check' | 'subcharter' | 'hire' | 'offer' | 'refit' | 'lease' | 'decision' | 'sheet' | 'market' | 'aircraft' | 'crew' | 'contract' | /** v0.7.2 */ 'sell' | 'cCheck'
  | /** v0.8 */ 'client' | 'rival' | 'worldEvent' | 'outlook';
export type TabId = 'map' | 'contracts' | 'schedule' | 'crew' | 'fleet' | 'finance' | 'company' | 'inbox';

export interface ProblemAction {
  /** 'crewControl' | 'adjustCrew' | 'planCheck' | 'subcharter' | 'hire' | 'findWork' | 'factor' | 'refit' | … */
  id: string;
  label: string;
  /** Where the button goes: a modal spec the UI understands, or a tab. */
  open: { modal: ModalKind; id: string; /** v0.9 round 4: the Crew Control row to open on ('callIn', 'delay', …). */ fix?: CrewFix } | { tab: TabId; view?: string; sel?: Ref };
  primary?: boolean;
}

export interface ReachSpec {
  /** Crew location → departure airport. */
  from: string;
  to: string;
  now: Minute;
  mustLandBy: Minute;
  report: Minute;
  departure: Minute;
  earliestArrival: Minute;
  /** The itinerary tried. */
  legs: { no: string; airline: string; from: string; to: string; dep: Minute; arr: Minute; jet?: boolean }[];
  /** earliestArrival − mustLandBy (> 0 = red gap). */
  gapMin: number;
}

export interface GaugeSpec {
  id: 'fdp' | 'rest' | 'duty7d' | 'block28d' | 'blockYear' | 'aCheck' | 'cCheck' | 'cash';
  label: string;
  /** Minutes, % (0–100) for checks, $ for cash. */
  value: number;
  limit: number;
  unit: 'hm' | 'pct' | 'usd';
  /** '10:45 of 11:00', '7:30 of 10:00 by 06:00', '82% used'. */
  text: string;
  tone: 'good' | 'warn' | 'bad';
  /** When the limit bites (rest ends, check due). */
  by?: Minute;
  crewId?: string;
}

export interface MiniMapSpec {
  crew: { id: string; name: string; at: string }[];
  /** Where they are needed. */
  to: string;
  path: { from: string; to: string; jet?: boolean; no?: string; dep: Minute; arr: Minute }[];
  departure: Minute;
}

export interface TimelineSpec {
  from: Minute;
  to: Minute;
  marks: { t: Minute; label: string; tone?: 'good' | 'warn' | 'bad' }[];
  spans: { from: Minute; to: Minute; label: string; tone: 'good' | 'warn' | 'bad' | 'off' }[];
}

export interface ProblemCard {
  subject: ProblemRef;
  severity: 'amber' | 'red';
  /** 'AWQ816 has no pilots'. */
  title: string;
  /** Same as title, full sentence. */
  what: string;
  /** ONE sentence, one main cause, layperson words. */
  why: string;
  hurt: Hurt;
  /** WHAT YOU CAN DO (ranked; the first is primary). */
  actions: ProblemAction[];
  /** Behind the 'Details' tap: every other cause/number, jargon allowed. */
  details: string[];
  /** Visual aids the UI may draw (all optional). */
  visuals: { reach?: ReachSpec; gauges?: GaugeSpec[]; minimap?: MiniMapSpec; timeline?: TimelineSpec };
  /** Glossary terms used in what/why (the UI wraps them in <Term>). */
  terms: TermId[];
  /** Deadline the card is about (departure, due date), for 'time left' chips. */
  by?: Minute;
}

/** '$1.24M', '$340K', '$12K', '$900' (the ops helper, repeated here to keep this module import-free). */
export function usdShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}

/** '2 h late' / '45 min late' / '~3 h late'. */
export function lateText(min: number, approx = false): string {
  const m = Math.round(min);
  if (m < 60) return `${approx ? '~' : ''}${m} min late`;
  const h = Math.round((m / 60) * 2) / 2;
  return `${approx ? '~' : ''}${h % 1 ? h.toFixed(1) : h} h late`;
}

/** The Inbox badge from a hurt snapshot: at most two of money, passengers and lateness, else 'no cost'. Pure. */
export function hurtBadges(h: Pick<Hurt, 'money' | 'pax' | 'delayMin' | 'level'>): string[] {
  const out: string[] = [];
  if (h.money > 0) out.push(usdShort(h.money));
  if (h.pax > 0) out.push(`${Math.round(h.pax)} pax`);
  if (h.delayMin >= 30 && out.length < 2) out.push(lateText(h.delayMin));
  if (!out.length) return ['no cost'];
  return out.slice(0, 2);
}

/** Builds the HURT line: level by the §1 thresholds, the text and the badges. `what` names the thing ('penalty', 'repair', 'cash short on 31 Mar'). */
export function mkHurt(x: { money?: number; pax?: number; delayMin?: number; legs?: number; what?: string; extra?: string; empty?: boolean }): Hurt {
  const money = Math.round(x.money ?? 0);
  const pax = Math.round(x.pax ?? 0);
  const delayMin = Math.round(x.delayMin ?? 0);
  const legs = x.legs ?? 0;
  const level: Hurt['level'] = money <= 0 && pax <= 0 ? 'none' : money < BAL.crewControl.hurtLowUsd && pax < BAL.crewControl.hurtLowPax ? 'low' : 'high';
  const parts: string[] = [];
  if (pax > 0) parts.push(`${pax} passengers`);
  else if (x.empty) parts.push('empty flight');
  if (legs > 1) parts.push(`${legs} flights`);
  if (delayMin >= 30) parts.push(lateText(delayMin, true));
  if (money > 0) parts.push(`${usdShort(money)} ${x.what ?? 'at stake'}`);
  else if (x.what === 'penalty' || x.empty) parts.push('no penalty');
  if (x.extra) parts.push(x.extra);
  const text = level === 'none' ? `Not much: ${parts.length ? parts.join(', ') : 'nothing lost yet'}` : `Yes: ${parts.join(', ')}`;
  return { money, pax, delayMin, legs, level, text, badges: hurtBadges({ money, pax, delayMin, level }) };
}

/** v0.9 round 4 (§V): the DOES-IT-HURT line as prose for an inbox body: 'Yes: ' / 'Not much: ' dropped, first letter capitalised. */
export const hurtProse = (card: Pick<ProblemCard, 'hurt'>): string => {
  // v0.11 it always follows a full sentence (the WHY), so it starts with a capital ('Nothing lost yet', not 'nothing lost yet').
  const t = card.hurt.text.replace(/^(Yes|Not much|Not now): /, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Tone of a value against its limit (0.75 / 0.95 of it). */
export const limitTone = (value: number, limit: number): GaugeSpec['tone'] => (limit <= 0 ? 'good' : value >= limit * 0.95 ? 'bad' : value >= limit * 0.75 ? 'warn' : 'good');

export const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.round(Math.max(0, m) % 60)).padStart(2, '0')}`;
