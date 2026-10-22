// v0.6 roster board (UPDATE-0.6.md §F1): filters and base › rank › type groups, the virtualised row layout,
// day columns, block and day-code text (only when it fits whole) and drag verdict labels. Pure, no React.

import type { RatingFamily } from '../../data/acmiTypes';
import { DAY } from '../../engine/core/time';
import type { CrewMember, Role } from '../../engine/core/types';
import { familyLabel, type BoardRow, type CalBlock, type DropTarget } from '../../engine/crew';
import { calKey, calLayer } from './crewLogic';
import { isPilotRole } from './screenLogic';

export type BoardZoom = 'week' | 'month';
export type RankFilter = 'all' | 'pilots' | 'cabin' | Role;

export interface BoardFilter {
  base: string;
  rank: RankFilter;
  family: RatingFamily | 'all';
  q: string;
}

export const NO_BOARD_FILTER: BoardFilter = { base: 'all', rank: 'all', family: 'all', q: '' };

export const ROW_H = 52;
export const GROUP_H = 28;
export const HEAD_H = 40;
export const LEFT_W = 176;
/** Days shown: a week back, six weeks on (conversions and notice periods reach past the roster horizon). */
export const BACK_DAYS = 7;
export const BOARD_DAYS = 49;

export type BoardItem = { kind: 'group'; key: string; label: string; ids: string[] } | { kind: 'crew'; id: string; group: string }
  /** v0.8 a mixed-crew contract's client cabin crew: one grey row, no names, not draggable. */
  | { kind: 'client'; id: string; group: string };

const ROLE_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];
export const ROLE_PLURAL: Record<Role, string> = { CPT: 'Captains', FO: 'First officers', CRP: 'Relief pilots', PUR: 'Pursers', CC: 'Cabin crew' };

export function matchBoard(c: CrewMember, f: BoardFilter): boolean {
  if (f.base !== 'all' && c.base !== f.base) return false;
  if (f.rank === 'pilots' ? !isPilotRole(c.role) : f.rank === 'cabin' ? isPilotRole(c.role) : f.rank !== 'all' && c.role !== f.rank) return false;
  if (f.family !== 'all' && !c.ratings.includes(f.family)) return false;
  const q = f.q.trim().toLowerCase();
  return !q || `${c.first} ${c.last} ${c.base} ${c.loc}`.toLowerCase().includes(q);
}

/**
 * Rows grouped by base › rank › type (first rating), home base first, then by surname: one header item per group
 * ('LIS · Captains · A320 (10)') followed by its crew.
 */
export function boardItems(crew: CrewMember[], f: BoardFilter, homeBase: string): BoardItem[] {
  const groups = new Map<string, { base: string; role: Role; fam: string; list: CrewMember[] }>();
  for (const c of crew) {
    if (!matchBoard(c, f)) continue;
    const fam = c.ratings[0] ?? '—';
    const key = `${c.base}|${c.role}|${fam}`;
    let gr = groups.get(key);
    if (!gr) groups.set(key, (gr = { base: c.base, role: c.role, fam, list: [] }));
    gr.list.push(c);
  }
  const sorted = [...groups.entries()].sort(([, a], [, b]) =>
    (a.base === homeBase ? 0 : 1) - (b.base === homeBase ? 0 : 1) || a.base.localeCompare(b.base)
    || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.fam.localeCompare(b.fam));
  const out: BoardItem[] = [];
  for (const [key, gr] of sorted) {
    gr.list.sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
    out.push({ kind: 'group', key, label: `${gr.base} · ${ROLE_PLURAL[gr.role]} · ${gr.fam === '—' ? gr.fam : familyLabel(gr.fam as RatingFamily)} (${gr.list.length})`, ids: gr.list.map((c) => c.id) });
    for (const c of gr.list) out.push({ kind: 'crew', id: c.id, group: key });
  }
  return out;
}

/** Top offset of every item and the total height. */
export function boardLayout(items: BoardItem[], groupH = GROUP_H): { tops: number[]; total: number } {
  const tops: number[] = [];
  let y = 0;
  for (const it of items) {
    tops.push(y);
    y += it.kind === 'group' ? groupH : ROW_H;
  }
  return { tops, total: y };
}

/** Index of the item at y (rows area coordinates), -1 outside. */
export function itemAt(tops: number[], total: number, y: number): number {
  if (y < 0 || y >= total || !tops.length) return -1;
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (tops[m] <= y) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/**
 * Items to render for a scroll position: the visible ones plus `overscan` rows each way, snapped to `snap` items so
 * scrolling re-renders only when the window really moves. Returns [from, to).
 */
export function visibleRange(tops: number[], total: number, scrollTop: number, viewH: number, overscan = 6, snap = 4): [number, number] {
  const n = tops.length;
  if (!n) return [0, 0];
  const a = Math.max(0, itemAt(tops, total, Math.max(0, Math.min(total - 1, scrollTop))));
  const b = Math.max(a, itemAt(tops, total, Math.max(0, Math.min(total - 1, scrollTop + viewH))));
  const from = Math.max(0, Math.floor((a - overscan) / snap) * snap);
  const to = Math.min(n, Math.ceil((b + 1 + overscan) / snap) * snap);
  return [from, to];
}

/** Day column width: Week fits 7 days, Month 31 (minimums keep the text legible; the grid scrolls). */
export function dayWidth(zoom: BoardZoom, viewW: number): number {
  const w = Math.max(0, viewW - LEFT_W);
  return zoom === 'week' ? Math.max(96, Math.floor(w / 7)) : Math.max(26, Math.floor(w / 31));
}

/** Day columns to draw for a horizontal scroll position, two days of overscan, snapped to 2 days. [from, to). */
export function dayWindow(scrollLeft: number, viewW: number, dayW: number, nDays = BOARD_DAYS, snap = 2): [number, number] {
  const a = Math.floor(Math.max(0, scrollLeft) / dayW) - 2;
  const b = Math.ceil((Math.max(0, scrollLeft) + Math.max(0, viewW - LEFT_W)) / dayW) + 2;
  const to = Math.min(nDays, Math.ceil(b / snap) * snap);
  return [Math.min(to, Math.max(0, Math.floor(a / snap) * snap)), to];
}

/** Text width estimate (px) at 12 px semibold; the board passes a canvas measure in the browser. */
export const estimateW = (s: string) => s.length * 7.4;

/** The first candidate that fits whole in px (with `pad` px of padding), else ''. Never truncated. */
export function fitText(cands: string[], px: number, measure: (s: string) => number = estimateW, pad = 12): string {
  for (const c of cands) if (c && measure(c) + pad <= px) return c;
  return '';
}

type Blk = Pick<CalBlock, 'kind' | 'flights' | 'label'> & { aug?: 1 | 2; ext?: boolean; split?: boolean };

/** v0.7.3 separator before a duty's mark in a label; the board draws the mark as a tag (a bed icon for 3P / 4P). */
export const MARK_SEP = '\u2003';

/** v0.7.3 a duty's mark: '3P' / '4P' (augmented, in-flight rest), '+1h' (planned extension), 'SPLIT', else ''. */
export function dutyMark(b: Pick<Blk, 'kind' | 'aug' | 'ext' | 'split'>): string {
  if (b.kind !== 'duty') return '';
  return b.aug ? `${2 + b.aug}P` : b.ext ? '+1h' : b.split ? 'SPLIT' : '';
}

const route = (b: Blk) => (b.flights?.length ? [b.flights[0].from, ...b.flights.map((f) => f.to)].join('–') : '');

/** Week-zoom label candidates, longest first ('NB2341 HAM–PMI–HAM' → 'NB2341 HAM–PMI' → 'HAM–PMI–HAM' → 'PMI'). */
export function blockCands(b: Blk): string[] {
  const base = baseCands(b);
  const mark = dutyMark(b);
  if (!mark) return base;
  // Marked first (longest first), then the plain words, then the mark alone on a short bar.
  return [...base.filter(Boolean).map((c) => `${c}${MARK_SEP}${mark}`), ...base, `${MARK_SEP}${mark}`];
}

/** 'NB2341 HAM–PMI' with its mark split off (the mark '' when none). */
export function splitMark(text: string): [string, string] {
  const i = text.indexOf(MARK_SEP);
  return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + MARK_SEP.length)];
}

function baseCands(b: Blk): string[] {
  const k = calKey(b);
  const r = route(b);
  switch (k) {
    case 'operating': {
      const f0 = b.flights?.[0];
      const no = f0?.no ?? '';
      const dest = f0?.to ?? '';
      const out = (b.flights?.length ?? 0) > 1 && no && f0 ? `${no} ${f0.from}–${f0.to}` : '';
      return [no && r ? `${no} ${r}` : '', out, r, no && dest ? `${no} ${dest}` : '', dest];
    }
    case 'positioning': return [r ? `POS ${r}` : '', 'POS'];
    case 'ferry': return [r ? `FERRY ${r}` : '', 'FERRY', 'FRY'];
    case 'ride': return [r ? `POS ${r}` : '', 'POS'];
    case 'deadhead': return [r ? `DH ${r}` : '', 'DH'];
    case 'off': return b.label === 'Free' ? [] : ['OFF'];
    case 'sick': return ['SICK'];
    case 'joining': return ['Joining', 'JOIN'];
    case 'training': return b.label.startsWith('Conversion') ? [b.label, 'CONV'] : [b.label, 'TRG'];
    case 'leave': return b.label === 'Left' ? ['Left'] : ['Leave', 'LV'];
    case 'standby': return ['Standby', 'SBY'];
    default: return [];
  }
}

/** Month-zoom day code of work and travel: a duty's first destination, else DH / POS. */
export function workCode(b: Blk): string {
  const k = calKey(b);
  if (k === 'operating') return b.flights?.[0]?.to ?? 'DUTY';
  if (k === 'ferry') return 'FRY';
  if (k === 'deadhead') return 'DH';
  if (k === 'positioning' || k === 'ride') return 'POS';
  return '';
}

/**
 * Work / travel blocks of a row by UTC day index from `from` (first block of each day wins: a duty over travel), with
 * the block's index `i` (the month tile is that block's tap / drag target).
 */
export function dayCodes(blocks: (Blk & Pick<CalBlock, 'start' | 'end'>)[], from: number, nDays: number): { day: number; code: string; key: string; i: number }[] {
  const by = new Map<number, { code: string; key: string; rank: number; i: number }>();
  for (const [i, b] of blocks.entries()) {
    const code = workCode(b);
    if (!code) continue;
    const day = Math.floor((b.start - from) / DAY);
    if (day < 0 || day >= nDays) continue;
    const rank = calKey(b) === 'operating' || calKey(b) === 'ferry' ? 0 : 1;
    const cur = by.get(day);
    if (!cur || rank < cur.rank) by.set(day, { code, key: calKey(b), rank, i });
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([day, v]) => ({ day, code: v.code, key: v.key, i: v.i }));
}

/** Smallest tap target (px, Apple HIG). */
export const HIT = 44;

export interface WeekLabel {
  /** Block index in the row. */
  i: number;
  text: string;
  /** Label left / width (px in the lane; width 0 = no label). */
  lx: number;
  lw: number;
  /** Tap / drag area left / width: block and label, widened to HIT px where the neighbours leave room. */
  hx: number;
  hw: number;
}

/**
 * Week zoom: each work / travel block's label ('AWQ121 LIS–FCO–LIS', 'DH LIS–FCO') in the band above the time bars,
 * using the free lane after (or before) the block within its day, up to the next block; plus its ≥ HIT px hit area.
 * Labels never overlap and are never truncated (the longest candidate that fits whole).
 */
export function weekLabels(blocks: (Blk & Pick<CalBlock, 'start' | 'end'>)[], from: number, dayW: number, measure: (s: string) => number = estimateW, pad = 10): WeekLabel[] {
  const ppm = dayW / DAY;
  const work = [...blocks.entries()].filter(([, b]) => calLayer(b) === 2 && b.kind !== 'rest').sort((a, b) => a[1].start - b[1].start);
  const out: WeekLabel[] = [];
  let cursor = -Infinity;
  for (let k = 0; k < work.length; k++) {
    const [i, b] = work[k];
    const bl = (b.start - from) * ppm;
    const br = Math.max(bl + 3, (b.end - from) * ppm);
    const next = k + 1 < work.length ? (work[k + 1][1].start - from) * ppm : Infinity;
    const dayL = Math.floor((b.start - from) / DAY) * dayW;
    const left = Math.max(dayL, cursor);
    const right = Math.min(next, Math.max(dayL + dayW, br));
    const text = fitText(blockCands(b), right - left, measure, pad);
    const lw = text ? measure(text) + pad : 0;
    const lx = text ? Math.max(left, Math.min(bl, right - lw)) : bl;
    let hx = text ? Math.min(bl, lx) : bl;
    let hr = text ? Math.max(br, lx + lw) : br;
    if (hr - hx < HIT) {
      const grow = (HIT - (hr - hx)) / 2;
      hx = Math.max(cursor, hx - grow);
      hr = Math.min(next, Math.max(hr + grow, hx + HIT));
    }
    out.push({ i, text, lx, lw, hx, hw: Math.max(0, hr - hx) });
    cursor = Math.max(cursor, br, hr);
  }
  return out;
}

export type TargetTone = 'legal' | 'tight' | 'illegal' | 'ineligible';

/** Bubble over the drag ghost for the hovered row. */
export function verdictText(t: DropTarget | undefined): string {
  if (!t) return '';
  const late = t.lateChange && t.level !== 'ineligible' ? ' · Late change: morale −2' : '';
  if (t.level === 'ineligible') return `✗ ${t.reason}`;
  if (t.kind === 'swap') return `${t.level === 'illegal' ? '✗ ' : ''}${t.reason}${late}`;
  return `${t.level === 'illegal' ? '✗' : '✓'} ${t.reason}${late}`;
}

/** Counts of each verdict (toolbar summary while dragging). */
export function targetCounts(targets: Record<string, DropTarget>, ids: string[]): Record<TargetTone, number> {
  const out: Record<TargetTone, number> = { legal: 0, tight: 0, illegal: 0, ineligible: 0 };
  for (const id of ids) {
    const t = targets[id];
    if (t) out[t.level]++;
  }
  return out;
}

/** Auto-scroll speed (px/s, signed) for a finger at y inside a scroller [top, bottom): up to max within edge px. */
export function edgeSpeed(y: number, top: number, bottom: number, edge = 48, max = 600): number {
  if (y < top + edge) return -max * Math.min(1, (top + edge - y) / edge);
  if (y > bottom - edge) return max * Math.min(1, (y - (bottom - edge)) / edge);
  return 0;
}

/** Morale dot tone: green ≥ 60, amber 40–59, red < 40. */
export const moraleTone = (m: number): 'good' | 'warn' | 'bad' => (m >= 60 ? 'good' : m >= 40 ? 'warn' : 'bad');

/** v0.7 C2: everything a board row draws, as one string; equal strings let the board keep the old row object. */
export function rowSig(r: BoardRow): string {
  let s = `${r.crewId}|${r.name}|${r.role}|${r.base}|${r.morale}|${r.leaves ?? ''}|${r.status}|${r.families.join(',')}`;
  for (const b of r.blocks) {
    s += `#${b.kind}:${b.start}:${b.end}:${b.label}:${b.detail}:${b.dutyId ?? ''}:${b.pairingId ?? ''}:${b.legality ?? ''}:${b.locked ? 1 : 0}:${b.movable ? 1 : 0}:${b.at ?? ''}`;
    for (const f of b.flights ?? []) s += `,${f.id}/${f.no}/${f.from}/${f.to}/${f.std}/${f.sta}/${f.type}`;
  }
  return s;
}

/** Keys for a row's blocks that survive blocks appearing or going before them (kind, start, duty), unique. */
export function blockKeys(blocks: CalBlock[]): string[] {
  const seen = new Set<string>();
  return blocks.map((b) => {
    const k0 = `${b.kind}|${b.start}|${b.dutyId ?? b.label}`;
    let k = k0;
    for (let n = 2; seen.has(k); n++) k = `${k0}#${n}`;
    seen.add(k);
    return k;
  });
}

/** Board items as one string (same groups, labels and order → same string). */
export const itemsSig = (items: BoardItem[]) => items.map((x) => (x.kind === 'group' ? `g:${x.key}:${x.label}:${x.ids.join(',')}` : x.kind === 'client' ? `k:${x.id}` : `c:${x.id}`)).join(';');

/** v0.8 the 'Client cabin crew' group after our crew: shown with every rank or the cabin ranks, no search. */
export function clientItems(rows: { key: string; label: string }[], f: Pick<BoardFilter, 'rank' | 'q'>): BoardItem[] {
  if (!rows.length || f.q.trim() || !(f.rank === 'all' || f.rank === 'PUR' || f.rank === 'CC')) return [];
  return [
    { kind: 'group', key: 'client-crew', label: `Client cabin crew · flown with ours, rostered by the client (${rows.length})`, ids: [] },
    ...rows.map((r) => ({ kind: 'client' as const, id: r.key, group: 'client-crew' })),
  ];
}
