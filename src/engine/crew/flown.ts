// v0.18.1 (player's report: "the duties on 1–6 November have no flights or flight numbers") each duty and journey a crew
// member flies is recorded with its legs when it ends, so the calendar shows its flights after the flights, duties and
// trips themselves are pruned (a week after). Kept 70 days (the calendar shows last month). Write-only for the engine:
// nothing reads it but the calendar (a game saved and loaded holds the same records: determinism).

import { DAY } from '../core/time';
import type { CrewMember, Flight, FlownDuty, FlownLeg, GameState, Minute } from '../core/types';
import { commercialItinerary } from '../ops/commercial';
import { flightType } from '../ops/flightType';

export const FLOWN_DAYS = 70;

/** The legs of flights as recorded (a ticket: the airline's legs). */
export function flownLegs(g: GameState, fl: Flight[]): FlownLeg[] {
  const out: FlownLeg[] = [];
  for (const f of fl) {
    if (f.kind === 'deadhead') {
      const legs = f.charter ? [] : commercialItinerary(g, f);
      if (legs.length) for (const l of legs) out.push([l.no, l.from, l.to, l.dep, l.arr, 'deadhead']);
      else out.push([f.charter ? `${f.charter.operator}` : f.no, f.from, f.to, f.atd ?? f.std, f.ata ?? f.sta, 'deadhead']);
    } else out.push([f.no, f.from, f.to, f.atd ?? f.std, f.ata ?? f.sta, flightType(g, f)]);
  }
  return out;
}

/** Records a duty or journey [s, e) with its legs; drops what is older than 70 days. */
export function noteFlown(g: GameState, c: CrewMember, s: Minute, e: Minute, legs: FlownLeg[], pax = false, lv = false): void {
  if (!legs.length) return;
  const list = (c.flown ??= []);
  // The same duty logged twice (a late release re-run) replaces the earlier record.
  const same = list.findIndex((x) => x.s === s && !!x.pax === pax);
  // (v0.19.3 lv: a trip inside annual leave, drawn on the leave.)
  const rec: FlownDuty = { s, e, legs, ...(pax ? { pax: true as const } : {}), ...(lv ? { lv: true as const } : {}) };
  if (same >= 0) list[same] = rec;
  else list.push(rec);
  if (list[0].e < g.now - FLOWN_DAYS * DAY) c.flown = list.filter((x) => x.e >= g.now - FLOWN_DAYS * DAY);
}

/**
 * Older saves (load): the duties of the log whose flights are still kept (the last week) are recorded now; older ones
 * stay as their log line (sectors and block only).
 */
export function rebuildFlown(g: GameState): void {
  const byCrew = new Map<string, Flight[]>();
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'done') continue;
    for (const id of new Set([...f.crewIds, ...(f.riders ?? [])])) (byCrew.get(id) ?? byCrew.set(id, []).get(id)!).push(f);
  }
  for (const c of Object.values(g.crew)) {
    if (c.flown) continue;
    const mine = (byCrew.get(c.id) ?? []).sort((a, b) => (a.atd ?? a.std) - (b.atd ?? b.std));
    if (!mine.length) continue;
    for (const e of c.log) {
      const fl = mine.filter((f) => (f.atd ?? f.std) >= e.start && (f.atd ?? f.std) < e.end);
      if (!fl.length) continue;
      const pax = e.sectors === 0;
      (c.flown ??= []).push({ s: e.start, e: e.end, legs: flownLegs(g, fl), ...(pax ? { pax: true as const } : {}) });
    }
  }
}
