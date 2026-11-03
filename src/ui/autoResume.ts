// v0.15 auto-resume (the player: "after I have done the action it asks me to, it still says 'decision waiting' and I
// have to unpause and pick my speed again"). When the game stops the clock by itself it keeps a hold: the speed it was
// running at and, per reason, the subjects the pause is about (decision ids, the urgent offer, the short flights, the
// watch-desk rule). Every look (store.emit) drops the reasons whose subjects are all gone (answered, accepted or
// declined, fixed); the last one gone, the clock runs again at that speed. A reason with nothing to point at (month
// closed, a contract starting, a market offer, an AOG operations already handled) is a note: it waits for Play.
// A pause the player made (Space, the pause button, a load) never resumes by itself: its hold keeps no speed.
// Pure helpers; the store owns the state (and mirrors it into the save, GameState.autoHold).

import { PAUSE_ORDER, type PauseReason } from '../engine/core/pause';
import { SPEEDS, type GameSpeed } from '../engine/core/time';
import type { GameState } from '../engine/core/types';
import { shortFlights } from '../engine/crew';
import { pausingRuleKeys } from '../engine/ops/heads';

/** One reason the clock is held and the subjects it waits on (none: a note, held until Play). */
export interface HoldItem {
  reason: PauseReason;
  keys: string[];
}

/** The game's own pause: the speed to go back to (null: the player's pause, never resumed by itself) and why. */
export interface Hold {
  resume: GameSpeed | null;
  items: HoldItem[];
}

/** v0.15 an old save (or one with no speed recorded) resumes at this speed. */
export const DEFAULT_RESUME: GameSpeed = 1;

const REASONS = new Set<string>(PAUSE_ORDER);

/** The subjects a reason is about now (resolved = none of a hold's keys left). Pure. */
export function subjectsOf(g: GameState, reason: PauseReason): string[] {
  switch (reason) {
    case 'decision':
      return g.decisions.map((d) => d.id);
    // The AOG's recovery card (a decision); handled by operations, nothing is left to answer.
    case 'aog':
      return g.decisions.filter((d) => d.kind === 'aog').map((d) => d.id);
    case 'urgentOffer':
      return Object.values(g.offers).filter((o) => o.status === 'open' && o.expires > g.now && o.urgency === 'urgent').map((o) => o.id);
    case 'crewShortage':
    case 'crewHours':
      return crewKeys(g, reason, false);
    case 'rule':
      return pausingRuleKeys(g);
    default:
      return [];
  }
}

/** Short flights of the reason's kind (any kind when none); `red`: only those inside the red stage, when there are some. */
function crewKeys(g: GameState, reason: 'crewShortage' | 'crewHours', red: boolean): string[] {
  const all = shortFlights(g);
  const want = reason === 'crewHours' ? 'hours' : 'short';
  const kind = all.filter((x) => (x.kind ?? 'short') === want);
  const pool = kind.length ? kind : all;
  const hot = red ? pool.filter((x) => x.stage === 'red') : [];
  return (hot.length ? hot : pool).map((x) => x.flightId);
}

/**
 * The subjects a pause raised now is about: the new ones when they can be told apart (an urgent offer posted this
 * minute, the flights inside the red stage, watch-desk subjects not `seen` before), else every current one. Pure.
 */
export function pauseKeys(g: GameState, reason: PauseReason, seenRules?: ReadonlySet<string>): string[] {
  if (reason === 'urgentOffer') {
    const all = subjectsOf(g, reason);
    const fresh = all.filter((id) => g.offers[id].created === g.now);
    return fresh.length ? fresh : all;
  }
  if (reason === 'crewShortage' || reason === 'crewHours') return crewKeys(g, reason, true);
  if (reason === 'rule') {
    const all = subjectsOf(g, reason);
    const fresh = seenRules ? all.filter((k) => !seenRules.has(k)) : [];
    return fresh.length ? fresh : all;
  }
  return subjectsOf(g, reason);
}

/** A hold with one more reason (the same reason's subjects merged). */
export function addItem(hold: Hold, item: HoldItem): Hold {
  const at = hold.items.findIndex((x) => x.reason === item.reason);
  if (at < 0) return { ...hold, items: [...hold.items, { reason: item.reason, keys: [...item.keys] }] };
  const old = hold.items[at];
  // A note joined by subjects (or the other way round) stays a note: only Play lifts it.
  const keys = old.keys.length && item.keys.length ? [...new Set([...old.keys, ...item.keys])] : [];
  return { ...hold, items: hold.items.map((x, i) => (i === at ? { reason: x.reason, keys } : x)) };
}

/** The reasons still waiting: a note always, a reason with subjects while any of them is still there. Pure. */
export function pendingItems(g: GameState, hold: Hold): HoldItem[] {
  return hold.items.filter((it) => {
    if (!it.keys.length) return true;
    const now = new Set(subjectsOf(g, it.reason));
    return it.keys.some((k) => now.has(k));
  });
}

/** The reason the top bar names: the first waiting one in PAUSE_ORDER. */
export function topReason(items: readonly HoldItem[]): PauseReason | null {
  for (const r of PAUSE_ORDER) if (items.some((x) => x.reason === r)) return r;
  return null;
}

/** The hold as the save keeps it (GameState.autoHold); null = nothing held (a save from v0.15 on). */
export function holdToSave(hold: Hold | null): NonNullable<GameState['autoHold']> | null {
  if (!hold) return null;
  return { ...(hold.resume !== null ? { speed: hold.resume } : { manual: true }), items: hold.items.map((x) => ({ reason: x.reason, keys: [...x.keys] })) };
}

/**
 * The hold a loaded game starts with. A v0.15 save keeps its own (no speed recorded: DEFAULT_RESUME); an older save
 * waiting on a decision was stopped by the game for it, so it resumes at DEFAULT_RESUME once answered. Pure.
 */
export function holdFromSave(g: GameState, decisionsHold: boolean): Hold | null {
  const s = g.autoHold;
  if (s === null) return null;
  if (s === undefined) return decisionsHold && g.decisions.length ? { resume: DEFAULT_RESUME, items: [{ reason: 'decision', keys: g.decisions.map((d) => d.id) }] } : null;
  if (typeof s !== 'object' || !Array.isArray(s.items)) return null;
  const items = s.items
    .filter((x): x is HoldItem => !!x && REASONS.has(x.reason) && Array.isArray(x.keys))
    .map((x) => ({ reason: x.reason, keys: x.keys.filter((k): k is string => typeof k === 'string') }));
  if (!items.length) return null;
  const resume = s.manual ? null : SPEEDS.includes(s.speed as GameSpeed) ? (s.speed as GameSpeed) : DEFAULT_RESUME;
  const hold: Hold = { resume, items };
  return pendingItems(g, hold).length ? { resume, items: pendingItems(g, hold) } : null;
}
