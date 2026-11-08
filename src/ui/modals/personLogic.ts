// v0.18 personal monthly roster (the person sheet): a Mon–Sun month grid in the person's base-local days, built from
// the engine's crewCalendar blocks. Trips (duties and travel away from base) and status windows (leave, sick, training,
// joining) are spans across their days; everything else is one tile a day (day off, standby, reserve, rest, free).
// Pure: no React, no writes.

import type { Minute } from '../../engine/core/types';
import type { CalBlock } from '../../engine/crew/calendar';

/** What a day tile (or a span) shows. */
export type DayKind =
  | 'trip' | 'pax' | 'leave' | 'sick' | 'training' | 'joining'
  | 'off' | 'offAway' | 'sby' | 'sbyHotel' | 'asby' | 'res' | 'rest' | 'free' | 'none';

/** The glyph drawn in a tile. */
export type DayIcon = 'plane' | 'pax' | 'ferry' | 'house' | 'bed' | 'phone' | 'tower' | 'clock' | 'palm' | 'sick' | 'cap' | 'join' | null;

export const SPAN_KINDS: ReadonlySet<DayKind> = new Set(['trip', 'pax', 'leave', 'sick', 'training', 'joining']);

export const DAY_KIND_LABEL: Record<DayKind, string> = {
  trip: 'Flying', pax: 'Positioning (passenger)', leave: 'Annual leave', sick: 'Sick', training: 'Training', joining: 'Joining', off: 'Day off at home', offAway: 'Day off away (hotel)',
  sby: 'Home standby', sbyHotel: 'Hotel standby', asby: 'Airport standby', res: 'Reserve', rest: 'Rest', free: 'Roster not out yet', none: 'No record kept',
};

export interface DayCell {
  /** Base-local day index (dayIndex). */
  k: number;
  /** UTC minutes of the local day [start, end). */
  start: Minute;
  end: Minute;
  /** Day of the month (1–31). */
  date: number;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  kind: DayKind;
  /** Span owner (trip / status window) when the day belongs to one, else null. */
  owner: string | null;
  icon: DayIcon;
  /** Short text under the icon: IATA code, 'XX', 'SBY E', 'ASBY'… ('' for none). */
  code: string;
  /** Small corner badge: 'A' airport standby on a flying day, '+1' planned extension. */
  badge: 'A' | '+1' | null;
  /** Worst legality of the day's duties. */
  legality: 'tight' | 'illegal' | null;
  /** v0.18.3 a night of a layover away from base falls on this day (the subtle marker). */
  layover: boolean;
  /** Blocks touching the day (for the details). */
  blocks: CalBlock[];
}

/** One row segment of the grid: a single day tile or a span over 1–7 days of this week. */
export type WeekItem =
  | { type: 'day'; col: number; cell: DayCell }
  | { type: 'span'; col: number; len: number; owner: string; kind: DayKind; cells: DayCell[]; /** continues from the previous week / into the next */ contL: boolean; contR: boolean };

export interface MonthGrid {
  weeks: WeekItem[][];
  cells: DayCell[];
  /** Trips and status windows by owner id: their blocks in order. */
  owners: Map<string, { kind: DayKind; k0: number; k1: number; blocks: CalBlock[] }>;
}

const WORK = new Set<CalBlock['kind']>(['duty', 'positioning', 'deadhead']);
const STATUS = new Set<CalBlock['kind']>(['sick', 'leave', 'training', 'joining']);

/** Where a work block leaves the person: its last flight's arrival (else its station). */
export function endAt(b: Pick<CalBlock, 'flights' | 'at'>): string | undefined {
  const f = b.flights;
  return f && f.length ? f[f.length - 1].to : b.at;
}

/** The station a flying day is labelled with: a turnaround (back where it started) shows the far end, else where it ends. */
export function stationOf(b: Pick<CalBlock, 'flights' | 'at'>): string {
  const f = b.flights ?? [];
  if (!f.length) return b.at ?? '';
  const last = f[f.length - 1].to;
  if (last === f[0].from && f.length > 1) {
    // The far end: the first arrival that is not the start (LIS–CDG–LIS → CDG; LIS–OPO–FAO–LIS → OPO).
    return f.find((x) => x.to !== f[0].from)?.to ?? last;
  }
  return last;
}

const isPax = (b: Pick<CalBlock, 'kind' | 'flights'>) => b.kind === 'positioning' || b.kind === 'deadhead' || (b.kind === 'duty' && !!b.flights?.length && b.flights.every((f) => f.type === 'positioning'));
const isFerry = (b: Pick<CalBlock, 'kind' | 'flights'>) => b.kind === 'duty' && !!b.flights?.length && b.flights.every((f) => f.type === 'ferry');

const overlap = (a: { start: number; end: number }, s: number, e: number) => a.start < e && a.end > s;

/** v0.18.3 one night-stop away from base: from arrival (release, or a journey's landing) to the next report or check-in. */
export interface Layover {
  at: string;
  from: Minute;
  to: Minute;
  /** The work blocks either side (the first ends there, the second starts there). */
  a: CalBlock;
  b: CalBlock;
  /** Hotel standby days inside it (their start minutes). */
  sby: Minute[];
}

/**
 * Every layover away from base among these blocks: between one work block that leaves the person at a station other
 * than base and the next work block, after a deadhead and across hotel standby or days off there too. Pure.
 */
export function layovers(blocks: CalBlock[], base: string): Layover[] {
  const work = blocks.filter((b) => WORK.has(b.kind)).sort((a, b) => a.start - b.start);
  const out: Layover[] = [];
  for (let i = 0; i + 1 < work.length; i++) {
    const a = work[i];
    const b = work[i + 1];
    const at = endAt(a);
    if (!at || at === base || b.start <= a.end) continue;
    const from = b.flights?.[0]?.from ?? b.at;
    if (from && from !== at) continue;
    const sby = blocks.filter((x) => x.kind === 'standby' && x.sby === 'hotel' && x.start < b.start && x.end > a.end).map((x) => x.start).sort((p, q) => p - q);
    out.push({ at, from: a.end, to: b.start, a, b, sby });
  }
  return out;
}

export interface GridOpts {
  /** Base-local day index of the 1st of the month. */
  k1st: number;
  /** Days in the month. */
  nDays: number;
  /** Weekday of the 1st (0 Mon … 6 Sun). */
  wd1st: number;
  /** UTC minute of local midnight for day k. */
  midnight: (k: number) => Minute;
  /** Base-local day index of a UTC minute. */
  dayOf: (t: Minute) => number;
  base: string;
  now: Minute;
  /** Days before this (base-local index) have no record (log pruned): drawn empty. */
  keptFrom?: number;
  /** Day of the month of base-local day k (for the dimmed days of the months around). */
  dateOf: (k: number) => number;
  /** Extra marks per duty id (planned extension). */
  ext?: (dutyId: string) => boolean;
}

/**
 * The month grid: Monday-first weeks covering the month (previous / next month days dimmed), each day classified and
 * spans laid out per week row. `blocks` must cover [midnight(first shown day), midnight(last shown day + 1)).
 */
export function monthGrid(blocks: CalBlock[], o: GridOpts): MonthGrid {
  const first = o.k1st - o.wd1st;
  const nWeeks = Math.ceil((o.wd1st + o.nDays) / 7);
  const last = first + nWeeks * 7 - 1;
  const todayK = o.dayOf(o.now);

  // Trips: work blocks chained while away from base. A planned day off or a standby between two duties away breaks the
  // span (that day is its own tile), as does a return to base.
  const work = blocks.filter((b) => WORK.has(b.kind)).sort((a, b) => a.start - b.start);
  const dayHas = (k: number, pred: (b: CalBlock) => boolean) => {
    const s = o.midnight(k);
    const e = o.midnight(k + 1);
    return blocks.some((b) => pred(b) && overlap(b, s, e));
  };
  const breaker = (b: CalBlock) => (b.kind === 'off' && b.label !== 'Rest (limits)') || b.kind === 'standby';
  type Trip = { k0: number; k1: number; blocks: CalBlock[] };
  const trips: Trip[] = [];
  let cur: Trip | null = null;
  let away = false;
  for (const b of work) {
    const k0 = o.dayOf(b.start);
    const k1 = o.dayOf(Math.max(b.start, b.end - 1));
    let join = !!cur && (away || k0 <= cur.k1);
    if (join && cur && k0 > cur.k1 + 1) {
      for (let k = cur.k1 + 1; k < k0; k++) if (dayHas(k, breaker)) join = false;
    }
    if (join && cur) {
      cur.blocks.push(b);
      cur.k1 = Math.max(cur.k1, k1);
    } else {
      cur = { k0, k1, blocks: [b] };
      trips.push(cur);
    }
    const at = endAt(b);
    away = !!at && at !== o.base;
  }

  // Owner per day: sick beats flying, flying beats leave / training / joining.
  const owners: MonthGrid['owners'] = new Map();
  const ownerOf = new Map<number, string>();
  const claim = (id: string, kind: DayKind, k0: number, k1: number, bl: CalBlock[], force: boolean) => {
    for (let k = Math.max(k0, first); k <= Math.min(k1, last); k++) {
      if (!force && ownerOf.has(k)) continue;
      ownerOf.set(k, id);
      const ow = owners.get(id);
      if (ow) {
        ow.k0 = Math.min(ow.k0, k);
        ow.k1 = Math.max(ow.k1, k);
      } else owners.set(id, { kind, k0: k, k1: k, blocks: bl });
    }
  };
  const status = blocks.filter((b) => STATUS.has(b.kind));
  // A status window owns a day it covers for at least 6 h (a sick call at 23:00 does not take the whole day).
  const statusDays = (b: CalBlock): [number, number] => {
    let k0 = o.dayOf(b.start);
    let k1 = o.dayOf(Math.max(b.start, b.end - 1));
    if (o.midnight(k0 + 1) - b.start < 6 * 60 && k1 > k0) k0++;
    if (b.end - o.midnight(k1) < 6 * 60 && k1 > k0) k1--;
    return [k0, k1];
  };
  for (const b of status) if (b.kind === 'sick') { const [a, z] = statusDays(b); claim(`sick:${b.start}`, 'sick', a, z, [b], true); }
  // v0.18.3 a trip of travel only (a deadhead or a ride as a passenger) is Positioning: its own colour and seat glyph.
  for (const t of trips) claim(`trip:${t.blocks[0].start}`, t.blocks.every(isPax) ? 'pax' : 'trip', t.k0, t.k1, t.blocks, false);
  for (const b of status) if (b.kind !== 'sick') { const [a, z] = statusDays(b); claim(`${b.kind}:${b.start}`, b.kind as DayKind, a, z, [b], false); }
  // Owners claimed piecemeal can have holes (a trip inside leave): recompute ranges from the days actually held.
  for (const [id, ow] of owners) {
    let a = Infinity;
    let z = -Infinity;
    for (const [k, x] of ownerOf) if (x === id) { a = Math.min(a, k); z = Math.max(z, k); }
    ow.k0 = a;
    ow.k1 = z;
  }

  const lays = layovers(blocks, o.base);
  const cells: DayCell[] = [];
  for (let k = first; k <= last; k++) {
    const s = o.midnight(k);
    const e = o.midnight(k + 1);
    const on = blocks.filter((b) => overlap(b, s, e));
    const owner = ownerOf.get(k) ?? null;
    const ow = owner ? owners.get(owner)! : null;
    const cell: DayCell = {
      k, start: s, end: e, date: k - o.k1st + 1, inMonth: k >= o.k1st && k < o.k1st + o.nDays, today: k === todayK, past: k < todayK,
      kind: 'free', owner, icon: null, code: '', badge: null, legality: null, blocks: on,
      layover: lays.some((l) => l.from < e && l.to > s && l.to - l.from >= 8 * 60),
    };
    if (!cell.inMonth) cell.date = o.dateOf(k);
    if (o.keptFrom !== undefined && k < o.keptFrom && !on.some((b) => b.kind !== 'rest')) {
      cell.kind = 'none';
    } else if (ow) {
      cell.kind = ow.kind;
      if (ow.kind === 'trip' || ow.kind === 'pax') {
        // The icon on the day a duty or journey starts; the last one that day names the station.
        const starts = ow.blocks.filter((b) => o.dayOf(b.start) === k);
        const b = starts[starts.length - 1];
        if (b) {
          cell.icon = isPax(b) ? 'pax' : isFerry(b) ? 'ferry' : 'plane';
          cell.code = b.kind === 'duty' ? stationOf(b) : endAt(b) ?? '';
        }
        for (const x of ow.blocks) {
          if (x.kind !== 'duty' || !overlap(x, s, e)) continue;
          if (x.legality === 'illegal') cell.legality = 'illegal';
          else if (x.legality === 'tight' && cell.legality !== 'illegal') cell.legality = 'tight';
          if (x.dutyId && o.ext?.(x.dutyId) && o.dayOf(x.start) === k) cell.badge = '+1';
        }
        if (on.some((x) => x.kind === 'standby' && x.sby === 'airport')) cell.badge = 'A';
      } else {
        // The icon and word on the window's first day and again at the start of each week row.
        const lead = ow.k0 === k || (k - first) % 7 === 0;
        cell.icon = lead ? STATUS_ICON[ow.kind] ?? null : null;
        cell.code = lead ? STATUS_CODE[ow.kind] ?? '' : '';
      }
    } else {
      const sby = on.find((b) => b.kind === 'standby');
      const off = on.find((b) => b.kind === 'off');
      if (sby) {
        cell.kind = sby.sby === 'hotel' ? 'sbyHotel' : sby.sby === 'airport' ? 'asby' : sby.sby === 'reserve' ? 'res' : 'sby';
        cell.icon = cell.kind === 'asby' ? 'tower' : cell.kind === 'res' ? 'clock' : 'phone';
        cell.code = cell.kind === 'sby' ? (sby.shift ? `SBY ${sby.shift}` : 'SBY') : cell.kind === 'sbyHotel' ? sby.at ?? 'SBY' : cell.kind === 'asby' ? 'ASBY' : 'RES';
      } else if (off && off.label === 'Day off') {
        cell.kind = off.at ? 'offAway' : 'off';
        cell.icon = off.at ? 'bed' : 'house';
        cell.code = off.at ?? 'XX';
      } else if (off && off.label === 'Free') {
        cell.kind = 'free';
      } else if (on.some((b) => b.kind === 'rest' || (b.kind === 'off' && b.label === 'Rest (limits)'))) {
        cell.kind = 'rest';
        cell.code = '';
      }
    }
    cells.push(cell);
  }

  const weeks: WeekItem[][] = [];
  for (let w = 0; w < nWeeks; w++) {
    const row: WeekItem[] = [];
    for (let col = 0; col < 7; col++) {
      const cell = cells[w * 7 + col];
      const ow = cell.owner ? owners.get(cell.owner) : undefined;
      if (!ow || cell.kind === 'none') {
        row.push({ type: 'day', col, cell });
        continue;
      }
      let len = 1;
      while (col + len < 7 && cells[w * 7 + col + len].owner === cell.owner && cells[w * 7 + col + len].kind !== 'none') len++;
      row.push({ type: 'span', col, len, owner: cell.owner!, kind: ow.kind, cells: cells.slice(w * 7 + col, w * 7 + col + len), contL: ow.k0 < cell.k, contR: ow.k1 > cell.k + len - 1 });
      col += len - 1;
    }
    weeks.push(row);
  }
  return { weeks, cells, owners };
}

const STATUS_ICON: Partial<Record<DayKind, DayIcon>> = { leave: 'palm', sick: 'sick', training: 'cap', joining: 'join' };
const STATUS_CODE: Partial<Record<DayKind, string>> = { leave: 'LEAVE', sick: 'SICK', training: 'TRAINING', joining: 'JOINS' };

export interface MonthTotals {
  /** Block minutes of duties starting in the month (flown and planned) and the flown part. */
  block: number;
  blockFlown: number;
  /** Duty minutes (report to release) of duties starting in the month. */
  duty: number;
  sectors: number;
  duties: number;
  /** Days away from base overnight (layovers). */
  nightsAway: number;
}

/**
 * Totals of the month's duties (base-local month [a, b)). `logOf(start)` gives the logged block and sectors of a flown
 * duty that no longer has its flights (pruned trips).
 */
export function monthTotals(blocks: CalBlock[], a: Minute, b: Minute, now: Minute, logOf: (start: Minute) => { block: number; sectors: number } | undefined, cells: DayCell[] = []): MonthTotals {
  const t: MonthTotals = { block: 0, blockFlown: 0, duty: 0, sectors: 0, duties: 0, nightsAway: 0 };
  for (const x of blocks) {
    if (x.kind !== 'duty' || x.start < a || x.start >= b) continue;
    t.duties++;
    t.duty += x.end - x.start;
    const fl = x.flights ?? [];
    if (fl.length) {
      for (const f of fl) {
        const m = Math.max(0, f.sta - f.std);
        t.block += m;
        if (f.sta <= now) t.blockFlown += m;
        t.sectors++;
      }
    } else {
      const e = logOf(x.start);
      const m = e?.block ?? 0;
      t.block += m;
      t.sectors += e?.sectors ?? 0;
      if (x.end <= now) t.blockFlown += m;
    }
  }
  t.nightsAway = cells.filter((c) => c.inMonth && (c.kind === 'trip' || c.kind === 'pax' || c.kind === 'offAway' || c.kind === 'sbyHotel') && c.blocks.some((x) => (x.kind === 'rest' || x.kind === 'off' || x.kind === 'standby') && !!x.at && x.end >= c.end - 60)).length;
  return t;
}

/** '62:30' from minutes. */
export const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;

/** Month navigation bounds: from `back` months before now's month to `ahead` months after. */
export function monthBounds(nowKey: number, back = 1, ahead = 2): [number, number] {
  return [nowKey - back, nowKey + ahead];
}
