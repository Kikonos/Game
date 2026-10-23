// v0.9 achievements (UPDATE-0.9.md §14.1): milestones for the Company › Achievements gallery, checked daily, at the
// month end and after the events that earn them. Some unlock a department head (ops/heads.ts). No money, no secrets.

import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, type AchievementDef, type AchievementId } from '../../data/achievements';
import { typeOf } from '../core/perf';
import { statementTotals } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { DAY, monthKey, toDate } from '../core/time';
import type { GameState, HeadId, Minute, StatsV09 } from '../core/types';
import { LEVEL_NAME, LEVEL_ORDER, levelOf } from '../contracts/relations';
import { companyMorale } from '../crew/morale';

export interface AchievementView {
  id: string; title: string; text: string; icon: string; group: AchievementDef['group'];
  at: Minute | null; progress: { have: number; need: number; label: string } | null; head?: HeadId;
}

type Progress = { have: number; need: number; label: string };

const ZERO: StatsV09 = { legalStreak: 0, cover: {}, slips: 0, oohRed: 0, oohAmber: 0, discretionUsed: 0, discretionRefused: 0, headHandled: 0, headMistakes: 0, jumboLoads: 0, lateGovPaid: 0, cOnTime: 0 };
const v9 = (g: GameState): StatsV09 => g.stats.v09 ?? ZERO;
const once = (n: number | undefined, label: string): Progress => ({ have: Math.min(1, n ?? 0), need: 1, label });
const days = (g: GameState, since: Minute | undefined) => (since === undefined ? 0 : Math.max(0, Math.floor((g.now - since) / DAY)));

/** Closed months (before this one) of a month record, oldest first: [key, a, b]. */
function closedMonths(g: GameState, rec: Record<number, [number, number]> | undefined): [number, number, number][] {
  const now = monthKey(g.now);
  return Object.entries(rec ?? {}).map(([k, v]) => [Number(k), v[0], v[1]] as [number, number, number]).filter((x) => x[0] < now).sort((a, b) => a[0] - b[0]);
}

/** Closed months in a row (ending with the last closed one) with ≥ 98 % crew coverage. */
function coverRun(g: GameState): number {
  const ms = closedMonths(g, v9(g).cover);
  let run = 0;
  for (let i = ms.length - 1; i >= 0; i--) {
    if (ms[i][1] === 0 || 1 - ms[i][2] / ms[i][1] < 0.98) break;
    if (i < ms.length - 1 && ms[i + 1][0] !== ms[i][0] + 1) break;
    run++;
  }
  return run;
}

/** Calendar years in the statements: net result and whether December is closed. */
function yearNets(g: GameState): Map<number, { net: number; closed: boolean }> {
  const out = new Map<number, { net: number; closed: boolean }>();
  for (const st of g.finance.history) {
    const y = Math.floor(st.month / 12);
    const e = out.get(y) ?? { net: 0, closed: false };
    e.net += statementTotals(st.lines).profit;
    if (st.month % 12 === 11) e.closed = true;
    out.set(y, e);
  }
  return out;
}

const bestLevel = (g: GameState) => Object.values(g.clients).reduce((b, c) => Math.max(b, LEVEL_ORDER.indexOf(levelOf(g, c))), 0);
const ownsWide = (g: GameState) => Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide');
const count = (have: number, need: number, what: string): Progress => ({ have: Math.min(need, have), need, label: `${Math.min(need, have)} of ${need} ${what}` });

interface Rule {
  /** Earned now (monthEnd: the month just closed is being judged). */
  earned: (g: GameState, monthEnd: boolean) => boolean;
  progress: (g: GameState) => Progress;
}

const RULES: Record<AchievementId, Rule> = {
  cleanSheet: { earned: (g) => v9(g).legalStreak >= 25, progress: (g) => count(v9(g).legalStreak, 25, 'sectors') },
  clockwork: {
    earned: (g) => closedMonths(g, v9(g).onTimeM).some(([, dep, ot]) => dep >= 40 && ot / dep >= 0.95),
    progress: (g) => {
      const r = v9(g).onTimeM?.[monthKey(g.now)] ?? [0, 0];
      const pct = r[0] ? Math.round((r[1] / r[0]) * 100) : 0;
      return { have: Math.min(95, pct), need: 95, label: `${pct} % on time this month (${r[0]} departures)` };
    },
  },
  outstationFix: { earned: (g) => (v9(g).outstationFix ?? 0) >= 1, progress: (g) => once(v9(g).outstationFix, 'Not yet') },
  ninetyClean: { earned: (g) => v9(g).lastCancel !== undefined && days(g, v9(g).lastCancel) >= 90, progress: (g) => count(days(g, v9(g).lastCancel), 90, 'days') },
  fullCover: { earned: (g) => coverRun(g) >= 2, progress: (g) => count(coverRun(g), 2, 'months') },
  bunkTime: { earned: (g) => (v9(g).restPlans ?? 0) >= 1, progress: (g) => once(v9(g).restPlans, 'Not yet') },
  slipCrew: { earned: (g) => v9(g).slips >= 1, progress: (g) => once(v9(g).slips, 'Not yet') },
  standby: { earned: (g) => (v9(g).roster?.callOuts ?? 0) >= 25, progress: (g) => count(v9(g).roster?.callOuts ?? 0, 25, 'call-outs') },
  goodPlace: {
    earned: (g, monthEnd) => monthEnd && (companyMorale(g) ?? 0) >= 75,
    progress: (g) => { const m = Math.round(companyMorale(g) ?? 0); return { have: Math.min(75, m), need: 75, label: `Morale ${m} of 75` }; },
  },
  cOnTime: { earned: (g) => v9(g).cOnTime >= 1, progress: (g) => once(v9(g).cOnTime, 'Not yet') },
  noOverdue: { earned: (g) => v9(g).lastOverdue !== undefined && days(g, v9(g).lastOverdue) >= 365, progress: (g) => count(days(g, v9(g).lastOverdue), 365, 'days') },
  fiveFlown: { earned: (g) => g.stats.contractsDone >= 5, progress: (g) => count(g.stats.contractsDone, 5, 'contracts') },
  paidInTheEnd: { earned: (g) => v9(g).lateGovPaid >= 1, progress: (g) => once(v9(g).lateGovPaid, 'Not yet') },
  partner: {
    earned: (g) => bestLevel(g) >= LEVEL_ORDER.indexOf('partner'),
    progress: (g) => { const b = bestLevel(g); return { have: Math.max(0, b - 1), need: 3, label: `Best client: ${LEVEL_NAME[LEVEL_ORDER[b]]}` }; },
  },
  firstCall: { earned: (g) => (v9(g).firstCall ?? 0) >= 1, progress: (g) => once(v9(g).firstCall, 'Not yet') },
  hajj: { earned: (g) => (v9(g).hajjDone ?? 0) >= 1, progress: (g) => once(v9(g).hajjDone, 'Not yet') },
  homeSafe: { earned: (g) => (v9(g).homeSafe ?? 0) >= 1, progress: (g) => once(v9(g).homeSafe, 'Not yet') },
  blueIce: { earned: (g) => (v9(g).antarctic ?? 0) >= 1, progress: (g) => once(v9(g).antarctic, 'Not yet') },
  widebody: { earned: (g) => ownsWide(g), progress: () => ({ have: 0, need: 1, label: 'Not yet' }) },
  queen: { earned: (g) => (v9(g).queenSectors ?? 0) >= 1, progress: (g) => once(v9(g).queenSectors, 'Not yet') },
  reliable: {
    earned: (g) => g.company.reputation.reliable >= 85,
    progress: (g) => { const r = Math.round(g.company.reputation.reliable); return { have: Math.min(85, r), need: 85, label: `Reliable ${r} of 85` }; },
  },
  cleanRecord: {
    earned: (g) => g.company.reputation.clean >= 80,
    progress: (g) => { const r = Math.round(g.company.reputation.clean); return { have: Math.min(80, r), need: 80, label: `Clean ${r} of 80` }; },
  },
  inTheBlack: {
    earned: (g) => [...yearNets(g).values()].some((y) => y.closed && y.net > 0),
    progress: (g) => {
      const y = yearNets(g).get(toDate(g.now).getUTCFullYear());
      const net = Math.round((y?.net ?? 0) / 1000);
      return { have: net > 0 ? 1 : 0, need: 1, label: `This year so far: ${net < 0 ? '−' : ''}$${Math.abs(net)}K` };
    },
  },
  rainyDay: {
    earned: (g) => g.finance.history.some((st) => (st.cashEnd ?? 0) >= 5_000_000),
    progress: (g) => { const m = Math.max(0, Math.round(g.company.cash / 100_000) / 10); return { have: Math.min(5, m), need: 5, label: `Cash $${m}M of $5M` }; },
  },
};

/** Achievement progress (null once earned or unknown). Pure. */
export function achievementProgress(g: GameState, id: string): Progress | null {
  if (g.achievements?.[id] !== undefined) return null;
  return RULES[id as AchievementId]?.progress(g) ?? null;
}

/** Every achievement with the date earned or its progress. Pure. */
export function achievementsView(g: GameState): AchievementView[] {
  return ACHIEVEMENTS.map((a) => {
    const at = g.achievements?.[a.id] ?? null;
    return { id: a.id, title: a.title, text: a.text, icon: a.icon, group: a.group, at, progress: at === null ? RULES[a.id].progress(g) : null, ...(a.head ? { head: a.head } : {}) };
  });
}

/** ops/heads.ts: an achievement that earns a head unlocks it (silent: part of a backfill, one combined message). */
let unlockHook: ((g: GameState, id: HeadId, silent: boolean) => void) | null = null;
export function setHeadUnlockHook(f: typeof unlockHook): void {
  unlockHook = f;
}

/** Records one achievement: the message (topic 'achievement', the chime), then the head it earns. */
function earn(g: GameState, id: AchievementId, silent: boolean): void {
  const a = ACHIEVEMENT_BY_ID[id];
  (g.achievements ??= {})[id] = g.now;
  if (!silent) pushMessage(g, { tone: 'good', cat: 'goal', topic: 'achievement', title: `Achievement: ${a.title}`, body: `${a.text}.`, cue: 'achievement' });
  if (a.head) unlockHook?.(g, a.head, silent);
}

/**
 * Checks the given achievements (all by default) and records those now earned; `monthEnd` judges the month just
 * closed. Returns the ids earned. Daily, at the month end and after the events that earn them.
 */
export function checkAchievements(g: GameState, opts: { ids?: readonly AchievementId[]; monthEnd?: boolean; silent?: boolean } = {}): AchievementId[] {
  const have = (g.achievements ??= {});
  const out: AchievementId[] = [];
  for (const id of opts.ids ?? (ACHIEVEMENTS.map((a) => a.id) as AchievementId[])) {
    if (have[id] !== undefined) continue;
    if (RULES[id].earned(g, !!opts.monthEnd)) {
      earn(g, id, !!opts.silent);
      out.push(id);
    }
  }
  return out;
}

/** Event-driven checks (cheap subsets). */
export const ON_DEPARTURE: readonly AchievementId[] = ['cleanSheet', 'bunkTime', 'queen'];
export const ON_ARRIVAL: readonly AchievementId[] = ['blueIce', 'slipCrew'];

/**
 * load (§14.1): an older save starts with none and earns, silently, what it already has (one summary message, no
 * toasts or chimes; heads it earns unlock with their own combined message).
 */
export function loadAchievements(g: GameState): AchievementId[] {
  if (g.achievements) return [];
  g.achievements = {};
  const got = checkAchievements(g, { monthEnd: true, silent: true });
  if (!got.length) return got;
  const names = got.map((id) => ACHIEVEMENT_BY_ID[id].title);
  pushMessage(g, {
    tone: 'good', cat: 'goal', title: `${got.length} of ${ACHIEVEMENTS.length} achievements already earned`,
    body: `From before v0.9: ${names.join(', ')}. See Company › Achievements.`, cue: null,
  });
  return got;
}

/** Dev/test: records one achievement now (with its message and head). Returns the id, '' when unknown or held. */
export function grantAchievement(g: GameState, id: string): string {
  if (!RULES[id as AchievementId] || g.achievements?.[id] !== undefined) return '';
  earn(g, id as AchievementId, false);
  return id;
}
