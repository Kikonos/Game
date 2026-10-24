// v0.7.1 plain-language problems (UPDATE-0.7.1.md §5, §8, §10): pure helpers for the ProblemCard, the reach bar, the
// timeline, the glossary wrapping and the card's action buttons. No React, no writes.

import { GLOSSARY, TERM_WORDS, type GlossaryEntry, type TermId } from '../../data/glossary';
import type { RatingFamily } from '../../data/acmiTypes';
import type { Reason } from '../../engine/crew';
import { fmtTime, HOUR } from '../../engine/core/time';
import type { GameState, Minute, Ref, Role } from '../../engine/core/types';
import { hm, hurtProse } from '../../engine/problems/types';
import type { GaugeSpec, ProblemAction, ProblemCard, ReachSpec, TimelineSpec } from '../../engine/problems/types';
import type { ModalSpec, Tab } from '../store';

export interface TextSeg {
  text: string;
  term?: TermId;
}

const ROLES: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];
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
  /** Where the label sits (0–100): the tick's x, pushed along when two labels of one row would overlap. */
  lx?: number;
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
/** Labels of one row at least this far apart (% of the bar: 'Earliest landing' is ~95 px in a 400 px card). */
const LABEL_GAP = 24;

function alternate<T extends { x: number; side: 'above' | 'below'; lx?: number }>(ticks: T[]): T[] {
  const sorted = [...ticks].sort((a, b) => a.x - b.x);
  sorted.forEach((t, i) => (t.side = i % 2 ? 'below' : 'above'));
  // Labels two apart share a row: push the later one along (never the tick), then pull a run back from the right edge.
  for (const side of ['above', 'below'] as const) {
    const row = sorted.filter((t) => t.side === side);
    let prev = -Infinity;
    for (const t of row) { t.lx = Math.max(t.x, prev + LABEL_GAP); prev = t.lx; }
    const over = prev - 100;
    if (over > 0) for (const t of row) t.lx = Math.max(0, (t.lx ?? t.x) - over);
  }
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

/**
 * 'The earliest flight lands 3 h 10 m too late' / 'lands with 40 min to spare'. `limited`: the ride lands in time
 * but the day after it would run too long (the card's WHY), so the bar must not read green.
 */
export function reachVerdict(spec: ReachSpec, limited = false): string {
  const m = Math.abs(Math.round(spec.gapMin));
  const span = m >= HOUR ? `${Math.floor(m / HOUR)} h${m % HOUR ? ` ${m % HOUR} min` : ''}` : `${m} min`;
  const tail = spec.gapMin <= 0 && limited ? ', but the day would then run too long' : '';
  if (!spec.legs.length && spec.from === spec.to) return spec.gapMin > 0 ? `They are ready ${span} too late` : `They are at ${spec.to} and ready in time${tail}`;
  return spec.gapMin > 0 ? `The earliest flight lands ${span} too late` : `The earliest flight lands with ${span} to spare${tail}`;
}

/** The tone of the reach verdict: red for a gap, amber when the ride lands in time but a limit bites after it. */
export const reachTone = (spec: ReachSpec, limited = false): 'good' | 'warn' | 'bad' => (spec.gapMin > 0 ? 'bad' : limited ? 'warn' : 'good');

/** Whether a card's place cause is really a day-length limit after the ride (its WHY says so, or it names the FDP). */
export const reachLimited = (card: Pick<ProblemCard, 'why' | 'terms'>): boolean => /day would (be|then run) too long/i.test(card.why) || card.terms.includes('fdp');

/** The part of a decision's body that the card does not already say (the 'It has been waiting…' tail); '' when nothing is left. */
export function decisionBodyTail(body: string, card: Pick<ProblemCard, 'what' | 'why' | 'hurt'> | null): string {
  if (!card) return body;
  let t = body;
  // Round 4: the WHAT without its ' for TP1234' tail and the hurt as prose (events.ts writes both that way).
  const what2 = card.what.replace(/ for [A-Z0-9]+$/, '');
  const prose = hurtProse(card);
  for (const part of [`${card.what}.`, card.what, `${what2}.`, what2, card.why, `${card.hurt.text}.`, card.hurt.text, `${prose}.`, prose]) if (part && t.includes(part)) t = t.replace(part, '');
  t = t.replace(/\s+/g, ' ').replace(/^[.;,\s]+/, '').trim();
  return t === body.trim() ? body : t;
}

const PLACE = /^At [A-Z]{3}, not [A-Z]{3}/;
const SUPERSEDED = /^(Overlaps another duty|On another (trip|tour)\b)/;

/**
 * The other reasons behind a person's root cause, for the 'and N more' tap: one location line at most (none when
 * the root is a busier cause), lines the root cause already says dropped, duplicates removed.
 */
export function moreReasons(reason: Reason): string[] {
  const out: string[] = [];
  let place = false;
  for (const t of reason.all) {
    if (t === reason.text || out.includes(t)) continue;
    if (PLACE.test(t)) {
      if (place || reason.code === 'place' || reason.code === 'busy') continue;
      place = true;
    } else if (reason.code === 'busy' && SUPERSEDED.test(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * The rest gauge measured NOW rather than at the next report (the crew card): a person resting shows '7:30 of 10:00
 * by 02:30' in amber; rest complete drops the 'by'. A rest that has not started yet (between two later duties) is
 * left as planned.
 */
export function restNow(spec: GaugeSpec, now: Minute): GaugeSpec {
  if (spec.id !== 'rest' || spec.by === undefined || spec.limit <= 0) return spec;
  const left = spec.by - now;
  if (left > spec.limit) return spec;
  const taken = Math.max(0, Math.min(spec.limit, spec.limit - left));
  const ok = taken >= spec.limit;
  return {
    ...spec, value: taken, text: `${hm(taken)} of ${hm(spec.limit)}`,
    tone: ok ? 'good' : taken >= spec.limit * 0.75 ? 'warn' : 'bad', by: ok ? undefined : spec.by,
  };
}

/** The views each screen knows (store.nav.view); the glossary's 'Show me' must land on one of them. */
export const KNOWN_VIEWS: Record<Tab, string[]> = {
  map: [], contracts: ['market', 'active', 'missed'], schedule: [], crew: ['people', 'board'], fleet: ['market'], finance: [], company: [], inbox: [],
};
const VIEW_LABEL: Record<string, string> = { market: 'Market', active: 'Active', missed: 'Missed', people: 'People', board: 'Roster board', plan: 'Planning' };
const TAB_LABEL: Record<Tab, string> = { map: 'Ops Map', contracts: 'Contracts', schedule: 'Schedule', crew: 'Crew', fleet: 'Fleet', finance: 'Finance', company: 'Company', inbox: 'Inbox' };
/** Older glossary targets, in the screens' own names. */
const VIEW_ALIAS: Record<string, { tab: Tab; view?: string; label?: string }> = {
  'crew/roster': { tab: 'crew', view: 'board' }, 'crew/policies': { tab: 'company', label: 'Policies' }, 'company/policies': { tab: 'company', label: 'Policies' },
};

/** Where a glossary entry's 'Show me' goes, with the button label in the screen's own words ('Crew › Roster board'). */
export function glossaryTarget(where: NonNullable<GlossaryEntry['where']>): { tab: Tab; view?: string; label: string } {
  const alias = where.view ? VIEW_ALIAS[`${where.tab}/${where.view}`] : undefined;
  const tab = alias?.tab ?? where.tab;
  const view = alias ? alias.view : where.view && KNOWN_VIEWS[tab].includes(where.view) ? where.view : undefined;
  const sub = alias?.label ?? (view ? VIEW_LABEL[view] ?? view : undefined);
  return { tab, view, label: `${TAB_LABEL[tab]}${sub ? ` › ${sub}` : ''}` };
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
    case 'crewControl': return { modal: { kind: 'crewControl', flightId: id, ...(o.fix ? { fix: o.fix } : {}) } };
    case 'duty': return { modal: { kind: 'duty', id } };
    // v0.7.2: 'Plan at Sofia' (a C-check card) opens the hub list.
    case 'check': return { modal: /^Plan at /.test(a.label) ? { kind: 'check', aircraftId: id, checkKind: 'C' } : { kind: 'check', aircraftId: id } };
    case 'cCheck': return { modal: { kind: 'check', aircraftId: id, checkKind: 'C' } };
    case 'sell': return { modal: { kind: 'sell', aircraftId: id } };
    case 'subcharter': {
      const f = g.flights[id];
      const cid = f?.contractId ?? (g.contracts[id] ? id : undefined);
      return cid ? { modal: { kind: 'subcharter', contractId: cid, flightId: f ? id : undefined } } : null;
    }
    case 'hire': return { modal: ROLES.includes(id as Role) ? { kind: 'hire', role: id as Role } : { kind: 'hire', family: id as RatingFamily } };
    case 'offer': return { modal: { kind: 'offer', offerId: id } };
    // v0.7.2: 'Plan crew rest' opens the refit dialog on crew rest; v0.7.3 'Plan a lower-deck module' picks that option.
    case 'refit': return { modal: /lower-deck/i.test(a.label) ? { kind: 'refit', aircraftId: id, section: 'rest', restOption: 'ldmcr' } : /crew rest|bunk|recliner/i.test(a.label) ? { kind: 'refit', aircraftId: id, section: 'rest' } : { kind: 'refit', aircraftId: id } };
    case 'lease': return { modal: { kind: 'lease', aircraftId: id } };
    case 'decision': return g.decisions.some((d) => d.id === id) ? { modal: { kind: 'decision', decisionId: id } } : { nav: { tab: 'inbox' } };
    case 'sheet': return { modal: { kind: 'sheet', refs: [{ kind: 'flight', id }, { kind: 'maint', id }] } };
    case 'market': return { nav: { tab: 'fleet', view: 'market', sel: { kind: 'market', id } } };
    case 'aircraft': return { nav: { tab: 'fleet', sel: { kind: 'aircraft', id } } };
    case 'crew': return { nav: { tab: 'crew', sel: { kind: 'crew', id } } };
    case 'contract': return { nav: { tab: 'contracts', view: 'active', sel: { kind: 'contract', id } } };
    // v0.8 World.
    case 'client': return { modal: { kind: 'client', clientId: id } };
    case 'rival': return { modal: { kind: 'rival', rivalId: id } };
    case 'worldEvent': return { modal: { kind: 'worldEvent', eventId: id } };
    case 'outlook': return { modal: { kind: 'outlook' } };
  }
  return null;
}

/** The CREW SHORTAGE banner tone of a flight still short ('amber' | 'red' | null). */
export function crewBanner(stage: 'amber' | 'red' | undefined, hoursLeft: number, redH = 12): 'amber' | 'red' | null {
  if (!stage) return null;
  return stage === 'red' || hoursLeft <= redH ? 'red' : 'amber';
}
