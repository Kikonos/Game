// Schedule Gantt (B5): pure layout helpers — blocks per aircraft row, idle gaps, day pills,
// tap picking and the time axis. DESIGN.md §6.3. No React, no writes.

import { BAL } from '../../engine/core/balance';
import { flightsOf } from '../../engine/core/entities';
import { DAY, HOUR, dayStart, fmtDay, fmtTime } from '../../engine/core/time';
import type { Flight, GameState, MaintenanceEvent, Minute, Ref } from '../../engine/core/types';
import { crewRev, dutyLegality, flightCrewStatus } from '../../engine/crew';
import { flightType, type FlightType } from '../../engine/ops/flightType';

export type ZoomDays = 3 | 7 | 28;
/** Pixels per hour at each zoom preset when the view width is unknown (the screen fits the preset to the width). */
export const ZOOM_PX_H: Record<ZoomDays, number> = { 3: 24, 7: 10, 28: 2.5 };
export const ppmOf = (z: ZoomDays) => ZOOM_PX_H[z] / 60;

/** Idle gaps shorter than this are not drawn. */
export const IDLE_MIN = 12 * HOUR;
/** Touch slop for picking (px). */
export const TAP_SLOP = 44;

export type BlockKind = 'flight' | 'pos' | 'maint' | 'idle' | 'pill' | 'sub';

export interface GanttBlock {
  key: string;
  kind: BlockKind;
  start: Minute;
  end: Minute;
  /** Contract colour index (flights, pills). */
  color: number | null;
  label: string;
  /** Short label for narrow blocks. */
  short?: string;
  refs: Ref[];
  /** Crew problem corner: uncrewed or illegal inside the roster horizon. */
  crew?: 'missing' | 'illegal' | null;
  done?: boolean;
  at?: string;
  /** v0.5.1 paint blocks: the client livery's primary (hatched). */
  paint?: string;
  /** v0.5.2 flights: Operating / Positioning / Ferry (same words and colours as the map). */
  ftype?: FlightType;
}

/** 'Paint · Saudia' (paint-in), 'Repaint' (strip after full paint), 'Decals off'. */
export function paintLabel(g: GameState, m: MaintenanceEvent): string {
  const c = m.paint ? g.contracts[m.paint.contractId] : undefined;
  if (m.paint?.phase === 'out') return c?.paint?.kind === 'decals' ? 'Decals off' : 'Repaint';
  const client = c ? g.clients[c.clientId]?.name : undefined;
  return client ? `Paint · ${client}` : 'Paint shop';
}

const colorOf = (g: GameState, f: Flight) => (f.contractId ? g.contracts[f.contractId]?.color ?? null : null);
const live = (f: Flight) => f.status !== 'cancelled';
const endOf = (f: Flight) => (f.status === 'done' ? f.ata ?? f.sta : f.status === 'enroute' ? Math.max(f.eta ?? f.sta, f.sta) : f.sta + f.delay);
const startOf = (f: Flight) => (f.atd ?? f.std + (f.status === 'scheduled' ? f.delay : 0));

/** Live per-duty checks for the next two days (the stored legality can lag a change), per state version. */
const liveCache = new WeakMap<GameState, { at: Minute; rev: number; byDuty: Map<string, boolean> }>();
const LIVE_SPAN = 2 * DAY;

function crewFlag(g: GameState, f: Flight, horizon: Minute): GanttBlock['crew'] {
  if (f.status !== 'scheduled' || f.std > horizon || !f.aircraftId) return null;
  const s = flightCrewStatus(g, f.id).level;
  if (s === 'missing' || s === 'illegal') return s;
  if (!f.dutyId || f.std > g.now + LIVE_SPAN) return null;
  const rev = crewRev(g);
  let c = liveCache.get(g);
  if (!c || c.at !== g.now || c.rev !== rev) liveCache.set(g, (c = { at: g.now, rev, byDuty: new Map() }));
  let bad = c.byDuty.get(f.dutyId);
  if (bad === undefined) c.byDuty.set(f.dutyId, (bad = dutyLegality(g, f.dutyId).level === 'illegal'));
  return bad ? 'illegal' : null;
}

/** Flights, maintenance, sub-chartered legs and idle gaps of one aircraft overlapping [from, to). */
export function rowBlocks(g: GameState, aircraftId: string, from: Minute, to: Minute, opts: { pills?: boolean; until?: Minute } = {}): GanttBlock[] {
  const horizon = g.now + BAL.rosterHorizonDays * DAY;
  const out: GanttBlock[] = [];
  const busy: [Minute, Minute, string][] = [];
  const flights = flightsOf(g, aircraftId).filter(live);
  for (const f of flights) {
    const s = startOf(f);
    const e = endOf(f);
    busy.push([s, e, f.to]);
    if (e < from || s > to) continue;
    const empty = f.kind === 'positioning' || f.kind === 'ferry';
    const ftype = flightType(g, f);
    out.push({
      key: f.id, kind: empty ? 'pos' : 'flight', start: s, end: e, color: colorOf(g, f), ftype,
      label: `${f.no} ${f.from}-${f.to}`, short: ftype === 'ferry' ? 'FERRY' : f.to, refs: [{ kind: 'flight', id: f.id }],
      crew: crewFlag(g, f, horizon), done: f.status === 'done', at: f.from,
    });
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId !== aircraftId || m.status === 'cancelled') continue;
    busy.push([m.start, m.end, m.at]);
    if (m.end < from || m.start > to) continue;
    if (m.kind === 'paint') {
      const c = m.paint ? g.contracts[m.paint.contractId] : undefined;
      // Paint-in in the client's colour; the strip back to ours in the company primary.
      const fill = m.paint?.phase === 'in' ? c?.paint?.livery.primary : g.company.livery.primary;
      out.push({ key: m.id, kind: 'maint', start: m.start, end: m.end, color: null, label: `${paintLabel(g, m)} · ${m.at}`, short: 'Paint', refs: [{ kind: 'maint', id: m.id }], done: m.status === 'done', at: m.at, paint: fill ?? '#8a96b3' });
      continue;
    }
    out.push({ key: m.id, kind: 'maint', start: m.start, end: m.end, color: null, label: m.kind === 'AOG' ? `AOG ${m.at}` : `${m.kind}-check ${m.at}`, short: m.kind, refs: [{ kind: 'maint', id: m.id }], done: m.status === 'done', at: m.at });
  }
  // Legs sub-chartered away from this aircraft's contracts: outlined in its row.
  for (const f of Object.values(g.flights)) {
    if (!f.operatedBy || !f.contractId || !live(f)) continue;
    if (g.contracts[f.contractId]?.aircraftIds[0] !== aircraftId) continue;
    const s = startOf(f);
    const e = endOf(f);
    if (e < from || s > to) continue;
    const rival = g.rivals.find((r) => r.id === f.operatedBy)?.name ?? 'rival';
    out.push({ key: f.id, kind: 'sub', start: s, end: e, color: colorOf(g, f), label: `${f.no} by ${rival}`, short: 'SUB', refs: [{ kind: 'flight', id: f.id }], done: f.status === 'done' });
  }
  const ac = g.fleet[aircraftId];
  // Gaps run from now to the timeline end (`until`), so the label shows the whole gap, not the visible slice.
  const end = Math.max(to, opts.until ?? to);
  for (const gap of idleGaps(busy, g.now, end, ac?.at ?? '')) {
    if (gap.to < from || gap.from > to) continue;
    // A gap that runs to the timeline end has no next commitment: say so instead of an arbitrary length.
    const label = gap.to >= end ? `free at ${gap.at} · nothing booked` : `idle ${durLabel(gap.to - gap.from)}`;
    out.push({ key: `idle-${gap.from}`, kind: 'idle', start: gap.from, end: gap.to, color: null, label, refs: [], at: gap.at });
  }
  const sorted = out.sort((a, b) => a.start - b.start || a.end - b.end);
  return opts.pills ? dayPills(sorted) : sorted;
}

/** Free gaps of at least IDLE_MIN in [from, to) between busy intervals (sorted or not). `at` = where the aircraft waits. */
export function idleGaps(busy: [Minute, Minute, string][], from: Minute, to: Minute, startAt = '', min = IDLE_MIN): { from: Minute; to: Minute; at: string }[] {
  const list = [...busy].sort((a, b) => a[0] - b[0]);
  const out: { from: Minute; to: Minute; at: string }[] = [];
  let cursor = from;
  let at = startAt;
  for (const [s, e, where] of list) {
    if (e <= cursor) {
      at = where;
      continue;
    }
    if (s - cursor >= min) out.push({ from: cursor, to: s, at });
    cursor = Math.max(cursor, e);
    at = where;
  }
  if (to - cursor >= min) out.push({ from: cursor, to, at });
  return out;
}

/** 28-day view: a day's flights (UTC day) merge into one pill; maintenance, idle and sub-charters stay. */
export function dayPills(blocks: GanttBlock[]): GanttBlock[] {
  const out: GanttBlock[] = [];
  const days = new Map<number, GanttBlock[]>();
  for (const b of blocks) {
    if (b.kind !== 'flight' && b.kind !== 'pos') {
      out.push(b);
      continue;
    }
    const d = Math.floor(b.start / DAY);
    const l = days.get(d);
    if (l) l.push(b);
    else days.set(d, [b]);
  }
  for (const [d, list] of days) {
    const count = new Map<number, number>();
    for (const b of list) if (b.color !== null) count.set(b.color, (count.get(b.color) ?? 0) + 1);
    const color = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const crew = list.some((b) => b.crew === 'illegal') ? 'illegal' : list.some((b) => b.crew === 'missing') ? 'missing' : null;
    const legs = list.filter((b) => b.kind === 'flight').length;
    out.push({
      key: `pill-${d}-${list[0].key}`, kind: legs ? 'pill' : 'pos', start: Math.min(...list.map((b) => b.start)), end: Math.max(...list.map((b) => b.end)),
      color, label: `${list.length} leg${list.length > 1 ? 's' : ''}`, short: String(list.length), refs: list.flatMap((b) => b.refs), crew,
      done: list.every((b) => b.done),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function durLabel(min: number): string {
  const d = Math.floor(min / DAY);
  const h = Math.floor((min % DAY) / HOUR);
  return d ? `${d}d ${h}h` : `${h}h`;
}

export interface Hit {
  block: GanttBlock;
  /** Distance in px from the tap to the block (0 = inside). */
  dist: number;
  width: number;
}

/** Blocks within `slop` px of a tap at minute `t`, nearest first (idle gaps excluded). */
export function pickBlocks(blocks: GanttBlock[], t: Minute, ppm: number, slop = TAP_SLOP): Hit[] {
  const hits: Hit[] = [];
  for (const b of blocks) {
    if (b.kind === 'idle') continue;
    const dist = t < b.start ? (b.start - t) * ppm : t > b.end ? (t - b.end) * ppm : 0;
    if (dist <= slop) hits.push({ block: b, dist, width: (b.end - b.start) * ppm });
  }
  return hits.sort((a, b) => a.dist - b.dist || a.block.start - b.block.start);
}

/** What a tap opens: a block it lands squarely on, or the nearby blocks (up to 6) as a short list. */
export function chooseHits(hits: Hit[]): GanttBlock[] {
  if (!hits.length) return [];
  const inside = hits.filter((h) => h.dist === 0);
  if (inside.length === 1 && inside[0].width >= 24) return [inside[0].block];
  if (hits.length === 1) return [hits[0].block];
  return hits.slice(0, 6).map((h) => h.block).sort((a, b) => a.start - b.start);
}

/** The idle gap under a tap, if any. */
export function idleAt(blocks: GanttBlock[], t: Minute): GanttBlock | undefined {
  return blocks.find((b) => b.kind === 'idle' && t >= b.start && t <= b.end);
}

export interface Tick {
  t: Minute;
  label: string;
  major: boolean;
}

/** Axis ticks: days (major, labelled) plus hours at 3 d (every 6 h) and 7 d (every 12 h); spaced for a fitted width. */
export function axisTicks(from: Minute, to: Minute, zoom: ZoomDays): Tick[] {
  const step = zoom === 3 ? 6 * HOUR : zoom === 7 ? 12 * HOUR : DAY;
  const out: Tick[] = [];
  for (let t = dayStart(from); t <= to; t += step) {
    if (t < from) continue;
    const major = t % DAY === 0;
    // 28 d: a day is ~30 px, too narrow for a date each; label the Mondays (epoch day 0, 1 Jan 2000, is a Saturday).
    const weekly = zoom === 28 && (Math.floor(t / DAY) + 5) % 7 !== 0;
    out.push({ t, major, label: weekly ? '' : major ? fmtDay(t) : fmtTime(t) });
  }
  return out;
}

/** Visible window in minutes for a scroll position, padded by 12 h and snapped to 6 h so renders stay rare. */
export function visibleWindow(scrollLeft: number, width: number, from: Minute, ppm: number, pad = 12 * HOUR): [Minute, Minute] {
  const snap = 6 * HOUR;
  const a = from + scrollLeft / ppm - pad;
  const b = from + (scrollLeft + width) / ppm + pad;
  return [Math.floor(a / snap) * snap, Math.ceil(b / snap) * snap];
}

/** Timeline span: a week back, then to the latest commitment (at least the schedule horizon), capped at 180 days. */
export function timelineSpan(g: GameState): [Minute, Minute] {
  const from = dayStart(g.now) - 7 * DAY;
  let last = g.now + (BAL.scheduleHorizonDays + 7) * DAY;
  for (const f of Object.values(g.flights)) if (f.status === 'scheduled' && f.sta > last) last = f.sta;
  for (const m of Object.values(g.maintenance)) if (m.status === 'planned' && m.end > last) last = m.end;
  return [from, Math.min(dayStart(last) + 2 * DAY, dayStart(g.now) + 180 * DAY)];
}
