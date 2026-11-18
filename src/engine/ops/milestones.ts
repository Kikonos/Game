// v0.25 r2 milestones (immersion): a short Inbox note when the company passes a round number of flights, of block
// hours flown for clients, of passengers, and on each anniversary of its start. Deterministic (no draws), checked once a
// day. An older save marks what it has already passed silently on load, so nothing old arrives in a burst; its
// passengers are not counted (the save never kept them), so its passenger milestones stay off.

import { pushMessage } from '../core/messages';
import { DAY, fmtDay } from '../core/time';
import type { GameState } from '../core/types';

const LEGS = [100, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000];
const BH = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];
const PAX = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];
const YEAR = 365 * DAY;

const n = (v: number) => v.toLocaleString('en-US');
const ord = (v: number) => (['', 'first', 'second', 'third', 'fourth', 'fifth'][v] ?? `${v}${v % 10 === 1 && v % 100 !== 11 ? 'st' : v % 10 === 2 && v % 100 !== 12 ? 'nd' : v % 10 === 3 && v % 100 !== 13 ? 'rd' : 'th'}`);

/** Every milestone the company has passed now ('legs:1000', 'bh:5000', 'pax:100000', 'year:2'). */
export function passedMilestones(g: GameState): string[] {
  const s = g.stats;
  const out: string[] = [];
  for (const v of LEGS) if (s.legs >= v) out.push(`legs:${v}`);
  for (const v of BH) if (s.blockMin >= v * 60) out.push(`bh:${v}`);
  if (s.paxFlown !== undefined) for (const v of PAX) if (s.paxFlown >= v) out.push(`pax:${v}`);
  const years = Math.floor((g.now - g.started) / YEAR);
  for (let y = 1; y <= years; y++) out.push(`year:${y}`);
  return out;
}

/** A new game counts passengers from the start; an older save marks what it has passed (no messages). Idempotent. */
export function loadMilestones(g: GameState, fresh: boolean): void {
  if (fresh) g.stats.paxFlown ??= 0;
  g.stats.milestones ??= passedMilestones(g);
}

/** Passengers on a revenue leg just flown (only counted on a save that counts them). */
export function countPax(g: GameState, pax: number): void {
  if (g.stats.paxFlown !== undefined) g.stats.paxFlown += Math.max(0, Math.round(pax));
}

function note(g: GameState, key: string): { title: string; body: string } {
  const [kind, raw] = key.split(':');
  const v = Number(raw);
  const co = g.company.name;
  switch (kind) {
    case 'legs': return { title: `Our ${n(v)}th revenue flight`, body: `${co} has flown ${n(v)} revenue flights since ${fmtDay(g.started)}. Thank the crews, the engineers and ops.` };
    case 'bh': return { title: `${n(v)} block hours`, body: `${n(v)} block hours flown for our clients since ${fmtDay(g.started)}.` };
    case 'pax': return { title: `${n(v)} passengers`, body: `${co} has carried ${n(v)} passengers since ${fmtDay(g.started)}.` };
    default: {
      const s = g.stats;
      const bits = [`${n(s.legs)} revenue flights`, `${n(Math.round(s.blockMin / 60))} block hours`];
      if (s.paxFlown !== undefined) bits.push(`${n(s.paxFlown)} passengers`);
      return { title: `${co}: ${v === 1 ? 'one year' : `${v} years`} flying`, body: `Our ${ord(v)} anniversary. Since ${fmtDay(g.started)}: ${bits.join(', ')}.` };
    }
  }
}

/** Daily: one note for each milestone passed since yesterday. */
export function dailyMilestones(g: GameState): void {
  // A scenario (its made-up history included) marks them silently: no notes inside a scenario, no burst after it.
  if (g.scen) {
    g.stats.milestones = passedMilestones(g);
    return;
  }
  const seen = new Set(g.stats.milestones ??= passedMilestones(g));
  for (const key of passedMilestones(g)) {
    if (seen.has(key)) continue;
    g.stats.milestones.push(key);
    const m = note(g, key);
    // Its own id (not g.seq): the note changes nothing else in the game.
    pushMessage(g, { id: `ms:${key}`, tone: 'good', cat: 'company', ...m });
  }
}
