// v0.11 Operations — the event director (roadmap pacing rule). Busy spells of 1–3 days alternate with quiet spells of
// about 3–5 days (Normal pace). In a quiet spell no new disruption card is raised, contract offers only trickle in
// (QUIET_OFFERS of the usual rate) and emergencies are rare; in a busy spell offers come in a wave, so over a year as
// many arrive as before (they bunch, they don't vanish). Spells are drawn on a side stream (seed, spell index): the
// main random sequence is untouched and a reloaded game sees the same spells. Pace (Settings → Gameplay) only changes
// the spells still to come (and shortens the current one when it is now too long).

import { hashUnit } from '../core/util';
import { DAY, dayStart } from '../core/time';
import type { DirectorState, GameState, Minute, Pace, Spell } from '../core/types';

/**
 * The Operations update live (the director's rhythm, disruptions, ramp inspections, the audit). The game, the tests and
 * the bot run with it on; the bot's OPS_OFF / OPS_NODISRUPT / OPS_NOWAVES switches are for balance experiments only.
 */
export const OPS_LIVE = { on: true, /** bot experiments: disruptions, ramp checks and the audit (off: the director alone) */ disrupt: true, /** bot experiments: offers in waves (off: the old steady flow) */ waves: true };

/** Spell lengths in whole days [min, max] by pace. */
export const PACE_SPELLS: Record<Pace, { busy: [number, number]; quiet: [number, number] }> = {
  calm: { busy: [1, 2], quiet: [5, 8] },
  normal: { busy: [1, 3], quiet: [3, 5] },
  busy: { busy: [1, 3], quiet: [1, 3] },
};
export const PACES: Pace[] = ['calm', 'normal', 'busy'];
export const PACE_LABEL: Record<Pace, string> = { calm: 'Calm', normal: 'Normal', busy: 'Busy' };
export const PACE_HINT: Record<Pace, string> = {
  calm: 'Long quiet spells (5–8 days) between short busy ones',
  normal: 'Quiet spells of 3–5 days between busy ones of 1–3 days',
  busy: 'Short quiet spells (1–3 days): more happens more often',
};

/** Contract offers in a quiet spell: this share of the usual rate (a trickle). */
export const QUIET_OFFERS = 0.35;
/** Emergencies (medical, bird strike, technical diversion, sick crew away) in a quiet spell: this share of their rate. */
export const QUIET_EMERGENCY = 0.2;
/** Optional disruptions in a busy spell run at most this many times their yearly rate (they are all in the busy days). */
const BUSY_BOOST_MAX = 2.5;

const mean = ([a, b]: [number, number]) => (a + b) / 2;
/** Expected share of days in busy spells at this pace. */
export const busyShare = (pace: Pace) => mean(PACE_SPELLS[pace].busy) / (mean(PACE_SPELLS[pace].busy) + mean(PACE_SPELLS[pace].quiet));

/** A fresh director: spells start with a busy one today (the opening offers). */
export function newDirector(g: GameState, pace: Pace = 'normal'): DirectorState {
  const d: DirectorState = { pace, spells: [], n: 0, days: { quiet: 0, busy: 0 } };
  g.director = d;
  draw(g, d, dayStart(g.now), 1);
  return d;
}

export function director(g: GameState): DirectorState {
  return g.director ?? newDirector(g);
}

/** One spell from `start` of the given kind (length from the side stream). */
function draw(g: GameState, d: DirectorState, start: Minute, busy: 0 | 1): Spell {
  const [lo, hi] = PACE_SPELLS[d.pace][busy ? 'busy' : 'quiet'];
  const days = lo + Math.floor(hashUnit(`${g.seed}:dir:${d.n++}`) * (hi - lo + 1));
  const s: Spell = [start, start + Math.min(hi, days) * DAY, busy];
  d.spells.push(s);
  return s;
}

/** Spells drawn through `until`. */
function ensure(g: GameState, d: DirectorState, until: Minute): void {
  if (!d.spells.length) draw(g, d, dayStart(g.now), 1);
  let last = d.spells[d.spells.length - 1];
  for (let i = 0; last[1] <= until && i < 400; i++) last = draw(g, d, last[1], last[2] ? 0 : 1);
}

/** The spell holding t. */
export function spellAt(g: GameState, t: Minute = g.now): Spell {
  const d = director(g);
  ensure(g, d, t);
  for (let i = d.spells.length - 1; i >= 0; i--) if (d.spells[i][0] <= t) return d.spells[i];
  return d.spells[0];
}

export const isQuiet = (g: GameState, t: Minute = g.now): boolean => OPS_LIVE.on && spellAt(g, t)[2] === 0;

/** Offer rate multiplier at t: a trickle in quiet spells, a wave in busy ones (the year's mean stays 1). */
export function offerFactor(g: GameState, t: Minute = g.now): number {
  if (!OPS_LIVE.on) return 1;
  if (isQuiet(g, t)) return QUIET_OFFERS;
  const b = busyShare(director(g).pace);
  return (1 - (1 - b) * QUIET_OFFERS) / b;
}

/** Optional disruptions (and client requests): none in quiet spells, their yearly rate packed into the busy days. */
export function optionalFactor(g: GameState, t: Minute = g.now): number {
  if (!OPS_LIVE.on) return 1;
  if (isQuiet(g, t)) return 0;
  return Math.min(BUSY_BOOST_MAX, 1 / busyShare(director(g).pace));
}

/** Emergencies happen in any spell, rarely in a quiet one. */
export const emergencyFactor = (g: GameState, t: Minute = g.now): number => (isQuiet(g, t) ? QUIET_EMERGENCY : 1);

/**
 * The time after `from` when `count` base-rate days of offers have accrued with the director's factor applied
 * (the next offer's arrival: gamma gaps are drawn in base days and laid over the spells). Pure but for drawing spells.
 */
export function afterOfferDays(g: GameState, from: Minute, count: number): Minute {
  if (!OPS_LIVE.on || !OPS_LIVE.waves) return from + Math.round(count * DAY);
  const d = director(g);
  let t = from;
  let left = count;
  for (let i = 0; i < 400 && left > 0; i++) {
    const s = spellAt(g, t);
    const f = s[2] ? (1 - (1 - busyShare(d.pace)) * QUIET_OFFERS) / busyShare(d.pace) : QUIET_OFFERS;
    const room = ((s[1] - t) / DAY) * f;
    if (room >= left) return t + Math.round((left / f) * DAY);
    left -= room;
    t = s[1];
  }
  return t;
}

/** Settings → Gameplay → Pace: the spells still to come follow the new pace; a current spell now too long is shortened. */
export function setPace(g: GameState, pace: Pace): void {
  const d = director(g);
  if (d.pace === pace) return;
  d.pace = pace;
  ensure(g, d, g.now);
  const cur = spellAt(g, g.now);
  d.spells = d.spells.filter((s) => s[0] <= cur[0]);
  const max = PACE_SPELLS[pace][cur[2] ? 'busy' : 'quiet'][1] * DAY;
  if (cur[1] - cur[0] > max) cur[1] = Math.max(dayStart(g.now) + DAY, cur[0] + max);
  ensure(g, d, g.now + 30 * DAY);
}

/** Daily: the day that just closed is counted quiet or busy; spells older than 60 days pruned. */
export function dailyDirector(g: GameState): void {
  const d = director(g);
  const days = (d.days ??= { quiet: 0, busy: 0 });
  if (g.now - DAY >= g.started) days[isQuiet(g, g.now - DAY / 2) ? 'quiet' : 'busy']++;
  ensure(g, d, g.now + 30 * DAY);
  while (d.spells.length > 1 && d.spells[0][1] < g.now - 60 * DAY) d.spells.shift();
}

/** Share of closed days that were quiet (bot, Company). */
export function quietShare(g: GameState): number {
  const days = director(g).days ?? { quiet: 0, busy: 0 };
  return days.quiet + days.busy ? days.quiet / (days.quiet + days.busy) : 0;
}

/** The current spell for the UI: 'Quiet days until Thu' / 'Busy days'. */
export function spellView(g: GameState): { quiet: boolean; until: Minute; pace: Pace } {
  const s = spellAt(g);
  return { quiet: s[2] === 0, until: s[1], pace: director(g).pace };
}
