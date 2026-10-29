// Schedule Gantt (B5): pure layout helpers — blocks per aircraft row, idle gaps, day pills,
// tap picking and the time axis. DESIGN.md §6.3. No React, no writes.

import { BAL } from '../../engine/core/balance';
import { flightsOf } from '../../engine/core/entities';
import { DAY, HOUR, dayStart, fmtDay, fmtTime } from '../../engine/core/time';
import type { Flight, GameState, MaintenanceEvent, Minute, Ref } from '../../engine/core/types';
import { crewRev, dutyLegality, flightCrewStatus } from '../../engine/crew';
import { flightType, type FlightType } from '../../engine/ops/flightType';
import { dryLeaseView } from '../../engine/ops/dryLease';

export type ZoomDays = 3 | 7 | 28;
/** Pixels per hour at each zoom preset when the view width is unknown (the screen fits the preset to the width). */
export const ZOOM_PX_H: Record<ZoomDays, number> = { 3: 24, 7: 10, 28: 2.5 };
export const ppmOf = (z: ZoomDays) => ZOOM_PX_H[z] / 60;

/** Idle gaps shorter than this are not drawn. */
export const IDLE_MIN = 12 * HOUR;
/** Touch slop for picking (px). */
export const TAP_SLOP = 44;

/** v0.7 'band': a delivering aircraft before its handover (grey, not tappable). */
export type BlockKind = 'flight' | 'pos' | 'maint' | 'idle' | 'pill' | 'sub' | 'band'
  /** v0.8 a dry lease out at the lessee (tappable: its sheet); a base programme that continues past its generated days. */
  | 'lease' | 'cont';

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
  /** v0.7.1: the crew-shortage ladder stage of a still-short flight (the CREW SHORT label). */
  alert?: 'amber' | 'red';
  done?: boolean;
  at?: string;
  /** v0.5.1 paint blocks: the client livery's primary (hatched). */
  paint?: string;
  /** v0.5.2 flights: Operating / Positioning / Ferry (same words and colours as the map). */
  ftype?: FlightType;
  /** v0.12 flights: the flight number (or why an empty leg flies) and the route, for the two-line label. */
  no?: string;
  route?: string;
}

// ---------- v0.12 block labels ----------

/** Width (px) of a character of the Gantt's semibold sans at 1 px (narrow digits and punctuation, wide W and M). */
const CHAR_W: Record<string, number> = { ' ': 0.27, '-': 0.4, '·': 0.3, '→': 0.85, I: 0.3, J: 0.5, L: 0.55, '1': 0.48, W: 0.96, M: 0.86 };
/** Rough rendered width (px) of a label at font size `fs`: per character, a little generous so it never clips. */
export function textW(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += CHAR_W[ch] ?? (ch >= 'a' && ch <= 'z' ? 0.56 : ch >= '0' && ch <= '9' ? 0.62 : 0.68);
  return Math.ceil(w * fs);
}

/** What a block shows: one line (full label, or just the number, or the short label), or two (number over route). */
export interface BlockText {
  lines: string[];
  /** The FERRY or CREW SHORT tag in front of the full label. */
  tag: 'ferry' | 'short' | null;
}

/** Inner padding (px) of a one-line block label, and of the two-line one (smaller type). */
const PAD = 12;
const PAD2 = 8;
/** Font sizes: block labels, the two-line label, the tags. */
const FS = 12;
const FS2 = 11;

/**
 * v0.12 the label a block of `w` px shows, only ever whole (never 'L…'): the full label (with its FERRY or CREW SHORT
 * tag when that fits too), else for an operating leg the flight number over the route on two lines, else the number,
 * else the short label. Maintenance, idle and lease blocks keep their one long label. Pure.
 */
export function blockText(b: Pick<GanttBlock, 'kind' | 'label' | 'short' | 'no' | 'route' | 'ftype' | 'alert'>, w: number): BlockText {
  const fitsShort = !!b.short && w >= PAD + (b.short.length === 1 ? 7.5 : 9 * b.short.length);
  if (!b.no || (b.kind !== 'flight' && b.kind !== 'pos')) return { lines: w >= 64 ? [b.label] : fitsShort ? [b.short!] : [], tag: null };
  const full = textW(b.label, FS);
  if (b.alert && w >= PAD + textW('CREW SHORT', FS) + 6 + full) return { lines: [b.label], tag: 'short' };
  if (b.ftype === 'ferry' && w >= PAD + textW('FERRY', FS) + 4 + full) return { lines: [b.label], tag: 'ferry' };
  if (w >= PAD + full) return { lines: [b.label], tag: null };
  // Two lines only in the tall (operating) block: the positioning one is too thin for two.
  if (b.kind === 'flight' && b.route && w >= PAD2 + Math.max(textW(b.no, FS2), textW(b.route, FS2))) return { lines: [b.no, b.route], tag: null };
  if (w >= PAD + textW(b.no, FS)) return { lines: [b.no], tag: null };
  return { lines: fitsShort ? [b.short!] : [], tag: null };
}

/** 'Paint · Saudia' (paint-in), 'Repaint' (strip after full paint), 'Decals off'. */
export function paintLabel(g: GameState, m: MaintenanceEvent): string {
  const c = m.paint ? g.contracts[m.paint.contractId] : undefined;
  if (m.paint?.phase === 'out') return c?.paint?.kind === 'decals' ? 'Decals off' : 'Repaint';
  const client = c ? g.clients[c.clientId]?.name : undefined;
  return client ? `Paint · ${client}` : 'Paint shop';
}

const PURPOSE_LABEL: Record<NonNullable<Flight['purpose']>, string> = { delivery: 'Delivery', return: 'Return', refit: 'Refit', check: 'C-check', sale: 'Sale', lease: 'Dry lease' };

/** Maintenance block label and short label: 'C-check LIS', 'Refit → 24J/90Y · HAM', 'Lease return SNN'. */
export function maintLabel(m: MaintenanceEvent): [string, string] {
  if (m.kind === 'AOG') return [`AOG ${m.at}`, 'AOG'];
  if (m.kind === 'refit') return [`Refit → ${m.refit?.cabin.label ?? 'new cabin'} · ${m.at}`, 'Refit'];
  if (m.kind === 'return') return [`Lease return ${m.at}`, 'Return'];
  return [`${m.kind}-check ${m.at}`, m.kind];
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
    // v0.7: delivery, lease-return and refit ferries say why they fly.
    const why = f.purpose ? PURPOSE_LABEL[f.purpose] : null;
    const crew = crewFlag(g, f, horizon);
    out.push({
      key: f.id, kind: empty ? 'pos' : 'flight', start: s, end: e, color: colorOf(g, f), ftype,
      label: why ? `${why} ${f.from}-${f.to}` : `${f.no} ${f.from}-${f.to}`, short: ftype === 'ferry' || why ? 'FERRY' : f.to, refs: [{ kind: 'flight', id: f.id }],
      no: why ?? f.no, route: `${f.from}-${f.to}`,
      crew, done: f.status === 'done', at: f.from, alert: crew && f.crewAlert ? f.crewAlert : undefined,
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
    const [label, short] = maintLabel(m);
    out.push({ key: m.id, kind: 'maint', start: m.start, end: m.end, color: null, label, short, refs: [{ kind: 'maint', id: m.id }], done: m.status === 'done', at: m.at });
  }
  // v0.7: before the handover a delivering aircraft shows a grey band to the handover at its site.
  const dac = g.fleet[aircraftId];
  if (dac?.status === 'delivering') {
    const site = dac.delivery?.site ?? dac.at;
    const hand = dac.delivery?.handover ?? dac.deliveredAt;
    busy.push([g.now, hand, site]);
    if (hand > from && g.now < to) out.push({ key: `band-${aircraftId}`, kind: 'band', start: Math.max(g.now, from - DAY), end: hand, color: null, label: `Delivering · handover ${site} ${fmtDay(hand)}`, short: 'DLV', refs: [], at: site });
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
  // v0.8 dry lease out: one block at the lessee between the delivery and the return ferries.
  for (const c of Object.values(g.contracts)) {
    if (!c.dry || c.status === 'cancelled' || !c.aircraftIds.includes(aircraftId)) continue;
    const v = dryLeaseView(g, c.id);
    if (!v) continue;
    const [s, e] = [v.out[1], v.back[0]];
    busy.push([s, e, v.site]);
    if (e < from || s > to) continue;
    out.push({ key: `lease-${c.id}`, kind: 'lease', start: s, end: e, color: c.color, label: `Dry lease · ${v.lessee} at ${v.site}`, short: 'LEASE', refs: [{ kind: 'contract', id: c.id }], done: v.phase === 'done', at: v.site });
  }
  const ac = g.fleet[aircraftId];
  // Gaps run from now to the timeline end (`until`), so the label shows the whole gap, not the visible slice.
  const end = Math.max(to, opts.until ?? to);
  for (const gap of idleGaps(busy, g.now, end, ac?.at ?? '')) {
    if (gap.to < from || gap.from > to) continue;
    // v0.8: a gap past the generated days of a base programme still running is the programme continuing.
    const cont = continuing(g, aircraftId, gap.from);
    if (cont) {
      const cEnd = Math.min(gap.to, cont.to);
      out.push({ key: `cont-${gap.from}`, kind: 'cont', start: gap.from, end: cEnd, color: cont.color, label: cont.label, short: 'CONT', refs: [{ kind: 'contract', id: cont.contractId }], at: gap.at });
      if (gap.to - cEnd >= IDLE_MIN) out.push({ key: `idle-${cEnd}`, kind: 'idle', start: cEnd, end: gap.to, color: null, label: gap.to >= end ? `free at ${cont.base} · nothing booked` : `idle ${durLabel(gap.to - cEnd)}`, refs: [], at: cont.base });
      continue;
    }
    // A gap that runs to the timeline end has no next commitment: say so instead of an arbitrary length.
    const label = gap.to >= end ? `free at ${gap.at} · nothing booked` : `idle ${durLabel(gap.to - gap.from)}`;
    out.push({ key: `idle-${gap.from}`, kind: 'idle', start: gap.from, end: gap.to, color: null, label, refs: [], at: gap.at });
  }
  // v0.11 an idle gap stops at a sub-chartered leg drawn in the same row (the label ran under the outline): the pieces either side
  // stay when they are 12 h or more, the last keeps a 'free at … · nothing booked' label.
  const subs = out.filter((b) => b.kind === 'sub');
  if (subs.length) {
    for (const idle of out.filter((b) => b.kind === 'idle')) {
      const cut = subs.filter((b) => b.end > idle.start && b.start < idle.end).sort((a, b) => a.start - b.start);
      if (!cut.length) continue;
      out.splice(out.indexOf(idle), 1);
      let at = idle.start;
      for (const [i, b] of [...cut, null].entries()) {
        const until = b ? b.start : idle.end;
        if (until - at >= IDLE_MIN) out.push({ ...idle, key: `${idle.key}-${i}`, start: at, end: until, label: b || !idle.label.startsWith('free at') ? `idle ${durLabel(until - at)}` : idle.label });
        if (b) at = Math.max(at, b.end);
      }
    }
  }
  const sorted = out.sort((a, b) => a.start - b.start || a.end - b.end);
  return opts.pills ? dayPills(sorted) : sorted;
}

/** v0.8 the base programme flying on this aircraft whose flights are generated day by day past `t`, if any. */
export function continuing(g: GameState, aircraftId: string, t: Minute): { to: Minute; color: number; label: string; base: string; contractId: string } | null {
  for (const c of Object.values(g.contracts)) {
    const p = c.pattern;
    if (p.kind !== 'base' || (c.status !== 'active' && c.status !== 'signed') || !c.aircraftIds.includes(aircraftId)) continue;
    if (c.generatedUntil >= p.to || p.to <= t || c.generatedUntil > t + DAY || c.start > t + DAY || c.generatedUntil < g.now - DAY) continue;
    const client = g.clients[c.clientId]?.name ?? 'Client';
    return { to: p.to, color: c.color, base: p.base, contractId: c.id, label: `${client} programme continues · flights added daily until ${fmtDay(p.to)}` };
  }
  return null;
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
    if (b.kind === 'idle' || b.kind === 'band' || b.kind === 'cont') continue;
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
export function axisTicks(from: Minute, to: Minute, zoom: ZoomDays, ppm?: number): Tick[] {
  const step = zoom === 3 ? 6 * HOUR : zoom === 7 ? 12 * HOUR : DAY;
  // v0.12 a narrow timeline (an iPhone on its side) keeps the hour lines but drops their labels before they collide.
  const hours = ppm === undefined || step * ppm >= 56;
  const out: Tick[] = [];
  for (let t = dayStart(from); t <= to; t += step) {
    if (t < from) continue;
    const major = t % DAY === 0;
    // 28 d: a day is ~30 px, too narrow for a date each; label the Mondays (epoch day 0, 1 Jan 2000, is a Saturday).
    const weekly = zoom === 28 && (Math.floor(t / DAY) + 5) % 7 !== 0;
    out.push({ t, major, label: weekly ? '' : major ? fmtDay(t) : hours ? fmtTime(t) : '' });
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

/**
 * v0.7.2.1 trip swap: the flight a long press at minute `t` picks up: the flight or positioning block under the finger
 * (nearest within the tap slop); in a 28-day pill, its leg nearest in time. Null over maintenance, idle or nothing.
 */
export function pressFlight(g: GameState, blocks: GanttBlock[], t: Minute, ppm: number): string | null {
  const hit = pickBlocks(blocks, t, ppm).find((h) => h.block.kind === 'flight' || h.block.kind === 'pos' || h.block.kind === 'pill');
  if (!hit) return null;
  const mid = (f: Flight) => (f.std + f.sta) / 2;
  const ids = hit.block.refs.filter((r) => r.kind === 'flight' && g.flights[r.id]).map((r) => r.id);
  ids.sort((a, b) => Math.abs(mid(g.flights[a]) - t) - Math.abs(mid(g.flights[b]) - t) || (a < b ? -1 : 1));
  return ids[0] ?? null;
}

/**
 * v0.7.2.2 check planning: the booked A-check, C-check or cabin refit a long press at minute `t` picks up to drag
 * along its row: the maintenance block nearest the finger (within the tap slop), when nothing else is nearer. Null
 * otherwise (paint, AOG, a lease return, or a flight closer to the finger).
 */
export function pressMaint(g: GameState, blocks: GanttBlock[], t: Minute, ppm: number): string | null {
  const hit = pickBlocks(blocks, t, ppm)[0];
  if (!hit || hit.block.kind !== 'maint') return null;
  const ref = hit.block.refs.find((r) => r.kind === 'maint');
  const m = ref ? g.maintenance[ref.id] : undefined;
  return m && (m.kind === 'A' || m.kind === 'C' || m.kind === 'refit') ? m.id : null;
}

/** v0.7.2.2: where a dragged booking would start: the finger's minute less where it was grabbed, snapped (30 min). */
export const dragStart = (t: Minute, grab: number, snap = 30): Minute => Math.round((t - grab) / snap) * snap;
