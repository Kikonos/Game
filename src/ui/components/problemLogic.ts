// v0.7.1 plain-language problems (UPDATE-0.7.1.md §5, §8, §10): pure helpers for the ProblemCard, the reach bar, the
// timeline, the glossary wrapping and the card's action buttons. No React, no writes.

import { GLOSSARY, TERM_WORDS, type TermId } from '../../data/glossary';
import type { RatingFamily } from '../../data/acmiTypes';
import { fmtTime, HOUR } from '../../engine/core/time';
import type { GameState, Message, Minute, Ref, Role } from '../../engine/core/types';
import type { ProblemAction, ReachSpec, TimelineSpec } from '../../engine/problems/types';
import type { ModalSpec, Tab } from '../store';

export interface TextSeg {
  text: string;
  term?: TermId;
}

const ROLES: Role[] = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits a card line into plain runs and glossary terms (each term wrapped once per text, longest word first,
 * whole words only; 'rest' never matches 'restaurant'). `only` limits the wrapping to the card's own terms.
 */
export function termSegments(text: string, only?: TermId[]): TextSeg[] {
  const words = [...TERM_WORDS].filter(([, id]) => !only || only.includes(id)).sort((a, b) => b[0].length - a[0].length);
  if (!text || !words.length) return [{ text }];
  const re = new RegExp(`\\b(${words.map(([w]) => esc(w)).join('|')})\\b`, 'gi');
  const out: TextSeg[] = [];
  const used = new Set<TermId>();
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const id = words.find(([w]) => w.toLowerCase() === m![1].toLowerCase())?.[1];
    if (!id || used.has(id)) continue;
    used.add(id);
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], term: id });
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/** The glossary line for a term. */
export const termShort = (id: TermId) => GLOSSARY[id]?.short ?? '';

export interface BarTick {
  key: string;
  t: Minute;
  label: string;
  /** 0–100 along the bar. */
  x: number;
  /** Alternating rows so neighbouring labels never overlap. */
  side: 'above' | 'below';
  tone?: 'good' | 'warn' | 'bad';
}

export interface BarLayout {
  from: Minute;
  to: Minute;
  ticks: BarTick[];
  /** The red stretch (0–100), when the earliest arrival is after must-land-by. */
  gap: { x0: number; x1: number } | null;
}

const pos = (t: Minute, from: Minute, to: Minute) => Math.max(0, Math.min(100, ((t - from) / Math.max(1, to - from)) * 100));

/** Alternates label rows in time order; a tick within `near` % of the previous one on the same side is pushed to the other. */
function alternate<T extends { x: number; side: 'above' | 'below' }>(ticks: T[]): T[] {
  const sorted = [...ticks].sort((a, b) => a.x - b.x);
  sorted.forEach((t, i) => (t.side = i % 2 ? 'below' : 'above'));
  return sorted;
}

/** Reach bar: now, must-land-by, report, departure and the earliest arrival on one 0–100 scale, the gap in red. */
export function reachLayout(spec: ReachSpec): BarLayout {
  const times = [spec.now, spec.mustLandBy, spec.report, spec.departure, spec.earliestArrival];
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const pad = Math.max(30, (hi - lo) * 0.06);
  const from = lo - pad;
  const to = hi + pad;
  const late = spec.gapMin > 0;
  const ticks: BarTick[] = alternate([
    { key: 'now', t: spec.now, label: 'Now', x: pos(spec.now, from, to), side: 'above' },
    { key: 'must', t: spec.mustLandBy, label: 'Must land by', x: pos(spec.mustLandBy, from, to), side: 'above', tone: late ? 'bad' : 'good' },
    { key: 'report', t: spec.report, label: 'Report', x: pos(spec.report, from, to), side: 'above' },
    { key: 'dep', t: spec.departure, label: 'Departs', x: pos(spec.departure, from, to), side: 'above' },
    { key: 'arr', t: spec.earliestArrival, label: 'Earliest landing', x: pos(spec.earliestArrival, from, to), side: 'above', tone: late ? 'bad' : 'good' },
  ]);
  const gap = late ? { x0: pos(spec.mustLandBy, from, to), x1: pos(spec.earliestArrival, from, to) } : null;
  return { from, to, ticks, gap };
}

export interface SpanBox {
  x0: number;
  x1: number;
  label: string;
  tone: TimelineSpec['spans'][number]['tone'];
}

/** Timeline: marks as ticks, spans as coloured stretches on the same 0–100 scale. */
export function timelineLayout(spec: TimelineSpec): BarLayout & { spans: SpanBox[] } {
  const all = [spec.from, spec.to, ...spec.marks.map((m) => m.t), ...spec.spans.flatMap((s) => [s.from, s.to])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = Math.max(30, (hi - lo) * 0.04);
  const from = lo - pad;
  const to = hi + pad;
  const ticks = alternate(spec.marks.map((m, i) => ({ key: `m${i}`, t: m.t, label: m.label, x: pos(m.t, from, to), side: 'above' as const, tone: m.tone })));
  const spans = spec.spans.map((s) => ({ x0: pos(s.from, from, to), x1: pos(s.to, from, to), label: s.label, tone: s.tone }));
  return { from, to, ticks, gap: null, spans };
}

/** 'The earliest flight lands 3 h 10 m too late' / 'lands with 40 min to spare'. */
export function reachVerdict(spec: ReachSpec): string {
  const m = Math.abs(Math.round(spec.gapMin));
  const span = m >= HOUR ? `${Math.floor(m / HOUR)} h${m % HOUR ? ` ${m % HOUR} min` : ''}` : `${m} min`;
  if (!spec.legs.length && spec.from === spec.to) return spec.gapMin > 0 ? `They are ready ${span} too late` : `They are at ${spec.to} and ready in time`;
  return spec.gapMin > 0 ? `The earliest flight lands ${span} too late` : `The earliest flight lands with ${span} to spare`;
}

/** 'TP 1342 LIS–DUS 05:10→07:10' per leg of the itinerary. */
export const legText = (l: ReachSpec['legs'][number]) => `${l.jet ? 'Private jet' : l.airline} ${l.no} ${l.from}–${l.to} ${fmtTime(l.dep)}→${fmtTime(l.arr)}`;

/** '11:40 UTC' and '12:40 DUS' for a tick (the local time at `airport`). */
export const tickTimes = (t: Minute, airport: string): [string, string] => [`${fmtTime(t)} UTC`, `${fmtTime(t, airport)} ${airport}`];

export type ActionTarget = { modal: ModalSpec } | { nav: { tab: Tab; view?: string; sel?: Ref } } | null;

/** Where a card's action button goes: a modal spec of ours, or a tab. */
export function actionTarget(g: GameState, a: ProblemAction): ActionTarget {
  const o = a.open;
  if ('tab' in o) return { nav: { tab: o.tab, view: o.view, sel: o.sel } };
  const id = o.id;
  switch (o.modal) {
    case 'crewControl': return { modal: { kind: 'crewControl', flightId: id } };
    case 'duty': return { modal: { kind: 'duty', id } };
    case 'check': return { modal: { kind: 'check', aircraftId: id } };
    case 'subcharter': {
      const f = g.flights[id];
      const cid = f?.contractId ?? (g.contracts[id] ? id : undefined);
      return cid ? { modal: { kind: 'subcharter', contractId: cid, flightId: f ? id : undefined } } : null;
    }
    case 'hire': return { modal: ROLES.includes(id as Role) ? { kind: 'hire', role: id as Role } : { kind: 'hire', family: id as RatingFamily } };
    case 'offer': return { modal: { kind: 'offer', offerId: id } };
    case 'refit': return { modal: { kind: 'refit', aircraftId: id } };
    case 'lease': return { modal: { kind: 'lease', aircraftId: id } };
    case 'decision': return g.decisions.some((d) => d.id === id) ? { modal: { kind: 'decision', decisionId: id } } : { nav: { tab: 'inbox' } };
    case 'sheet': return { modal: { kind: 'sheet', refs: [{ kind: 'flight', id }, { kind: 'maint', id }] } };
    case 'market': return { nav: { tab: 'fleet', view: 'market', sel: { kind: 'market', id } } };
    case 'aircraft': return { nav: { tab: 'fleet', sel: { kind: 'aircraft', id } } };
    case 'crew': return { nav: { tab: 'crew', sel: { kind: 'crew', id } } };
    case 'contract': return { nav: { tab: 'contracts', view: 'active', sel: { kind: 'contract', id } } };
  }
  return null;
}

/** Inbox 'Problems only': messages about a problem, warnings and bad news. */
export const isProblemMessage = (m: Message) => !!m.problem || m.tone === 'warn' || m.tone === 'bad';

/** The CREW SHORTAGE banner tone of a flight still short ('amber' | 'red' | null). */
export function crewBanner(stage: 'amber' | 'red' | undefined, hoursLeft: number, redH = 12): 'amber' | 'red' | null {
  if (!stage) return null;
  return stage === 'red' || hoursLeft <= redH ? 'red' : 'amber';
}
