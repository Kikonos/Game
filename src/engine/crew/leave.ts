// v0.18.1 annual leave by request (player's report: "there should be a leave allowance a year, and leave has to be
// approved by operations"). Each crew member has a yearly allowance in calendar days by the country of their base
// (BAL.v09.roster.leave.ent: the EU's 4 weeks, Portugal 30), pro rata in the year they join, with up to 10 unused days
// carried into the next year. They ask for it in blocks of 5–14 days, 3 weeks to 4 months ahead and never inside a
// month whose roster is out (crew/dayPlan.ts: published on the 15th). Operations decide: by the rules of the Company's
// leave policy (at most a share of a rank away on any day, no leave in the peak months), automatically or by the player,
// with the rules deciding what the player left open when the month's roster is planned. A refusal costs a little
// morale and the person asks again later. Daily, before the roster run; every pick deterministic (crew id order,
// hashUnit), no RNG.

import { BAL } from '../core/balance';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay, fromUTC, yearOf } from '../core/time';
import type { ActionResult, CrewMember, GameState, LeavePolicy, LeaveRequest, LeaveYear, Minute } from '../core/types';
import { AIRPORT_BY_CODE } from '../../data/airports';
import {
  blockedOn, busyDays, clearDays, dayIndex, firstDayOf, groupsOf, hashUnit, midnight, MONTH, monthOfDay, pubEndDay, publishedTo, removeOff,
} from './dayPlan';
import { moraleShock } from './morale';
import { crewIx, segsOf, touchCrewState } from './timeline';

const L = () => BAL.v09.roster.leave;
const ROLE_WORD: Record<string, [string, string]> = {
  CPT: ['captain', 'captains'], FO: ['first officer', 'first officers'], CRP: ['cruise relief pilot', 'cruise relief pilots'], PUR: ['purser', 'pursers'], CC: ['cabin crew member', 'cabin crew'],
};

/** The Company's leave policy (defaults for a save without one). */
export function leavePolicy(g: GameState): LeavePolicy {
  return (g.company.policies.leave ??= { ...L().policy, blackout: [...L().policy.blackout] });
}

// ---------- allowance ----------

/** Calendar days a year for crew based at `base`. */
export function leaveDaysFor(base: string): number {
  const ent = L().ent;
  return ent[AIRPORT_BY_CODE[base]?.country ?? ''] ?? ent.default;
}

const yearStartK = (y: number) => fromUTC(y, 1, 1) / DAY;

/**
 * The year's allowance: the base country's days, pro rata from joining (or the game's start). Read-only unless `store`
 * (a booking opens the record; reading never writes, so a screen showing it changes nothing).
 */
export function leaveYearOf(g: GameState, c: CrewMember, y: number, store = false): LeaveYear {
  const have = c.leaveYears?.[y];
  if (have) return have;
  const y0 = fromUTC(y, 1, 1);
  const y1 = fromUTC(y + 1, 1, 1);
  const from = Math.max(y0, c.hired, g.company.aocAt ?? g.started);
  const r: LeaveYear = { ent: Math.round((leaveDaysFor(c.base) * Math.max(0, y1 - from)) / (y1 - y0)), booked: 0 };
  if (store) {
    const ys = (c.leaveYears ??= {});
    ys[y] = r;
    for (const k in ys) if (+k < y - 1) delete ys[k];
  }
  return r;
}

/** Unused days carried into year y (only once y − 1 has ended), at most carryMax. */
export function leaveCarry(g: GameState, c: CrewMember, y: number): number {
  const prev = c.leaveYears?.[y - 1];
  if (!prev || g.now < fromUTC(y, 1, 1)) return 0;
  return Math.min(L().carryMax, Math.max(0, prev.ent - prev.booked));
}

export interface LeaveBalance {
  year: number;
  ent: number;
  carried: number;
  booked: number;
  /** Days asked for and not decided yet. */
  pending: number;
  left: number;
}

/** One crew member's leave for year y: allowance, carried, booked (approved), asked and left. Pure but for opening the year. */
export function leaveBalance(g: GameState, c: CrewMember, y = yearOf(g.now)): LeaveBalance {
  const r = leaveYearOf(g, c, y);
  const carried = leaveCarry(g, c, y);
  let pending = 0;
  for (const q of g.leaveRequests ?? []) if (q.crewId === c.id && q.status === 'pending') pending += daysInYear(c, q.from, q.days, y);
  return { year: y, ent: r.ent, carried, booked: r.booked, pending, left: Math.max(0, r.ent + carried - r.booked - pending) };
}

/** Days of the block [from, from + days) falling in calendar year y (base-local days). */
function daysInYear(c: CrewMember, from: Minute, days: number, y: number): number {
  const k = dayIndex(c.base, from);
  const a = Math.max(k, yearStartK(y));
  const b = Math.min(k + days, yearStartK(y + 1));
  return Math.max(0, b - a);
}

// ---------- the rules ----------

export interface LeaveVerdict {
  ok: boolean;
  /** Why the rules say no (plain), else ''. */
  why: string;
  /** Even the player cannot approve it (the roster is out, not enough days left, a rotation then). */
  hard: boolean;
}

/** On annual leave per family-and-role group and base-local day over [k0, k1), and group sizes. */
function groupLoad(g: GameState, k0: number, k1: number, skip?: string): { load: Map<string, Int16Array>; size: Map<string, number> } {
  const load = new Map<string, Int16Array>();
  const size = new Map<string, number>();
  for (const c of Object.values(g.crew)) {
    if (c.notice || c.id === skip) continue;
    const keys = groupsOf(c);
    for (const key of keys) size.set(key, (size.get(key) ?? 0) + 1);
    for (const b of c.blocks ?? []) {
      if (b.why !== 'leave' || !b.annual) continue;
      const a = Math.max(k0, dayIndex(c.base, b.from));
      const z = Math.min(k1, dayIndex(c.base, b.to - 1) + 1);
      if (a >= z) continue;
      for (const key of keys) {
        const arr = load.get(key) ?? load.set(key, new Int16Array(k1 - k0)).get(key)!;
        for (let k = a; k < z; k++) arr[k - k0]++;
      }
    }
  }
  return { load, size };
}

/** Most of a group of `size` that may be away at once (the share rounded, at least one). */
const capOf = (share: number, size: number) => Math.max(1, Math.round(share * size));

/** The rules on a request (or a block being chosen): the roster, the allowance, rotations, the peak months, the share away. */
export function leaveVerdict(g: GameState, c: CrewMember, from: Minute, days: number, self?: LeaveRequest, ctx?: { load: Map<string, Int16Array>; size: Map<string, number>; k0: number }): LeaveVerdict {
  const pol = leavePolicy(g);
  const k = dayIndex(c.base, from);
  if (from < publishedTo(g)) return { ok: false, hard: true, why: `The ${MONTH[monthOfDay(k) % 12]} roster is already out` };
  // Enough days left in each year the block touches (this request's own days not counted against it).
  for (const y of new Set([yearOf(midnight(c.base, k) + 720), yearOf(midnight(c.base, k + days - 1) + 720)])) {
    const bal = leaveBalance(g, c, y);
    const own = self && self.status === 'pending' ? daysInYear(c, self.from, self.days, y) : 0;
    if (daysInYear(c, from, days, y) > bal.left + own) return { ok: false, hard: true, why: `Only ${bal.left + own} days of ${y} leave left` };
  }
  // A deployment rotation or work already planned then (crew planning rosters leave round the rotation).
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (q.status === 'broken' || q.status === 'done') continue;
    const end = q.tour ? Math.max(q.end, q.tour.to) : q.end;
    const start = q.tour ? Math.min(q.start, q.tour.from) : q.start;
    if (start < midnight(c.base, k + days) && end > midnight(c.base, k)) return { ok: false, hard: true, why: q.tour ? 'On a rotation then' : 'Rostered to fly then' };
  }
  for (let d = k; d < k + days; d++) if (blockedOn(c, d)) return { ok: false, hard: true, why: 'Already away then (leave, a course or sick)' };
  const peak = [...new Set(Array.from({ length: days }, (_, i) => monthOfDay(k + i) % 12))].filter((m) => pol.blackout.includes(m));
  if (peak.length) return { ok: false, hard: false, why: `No leave in ${peak.map((m) => MONTH[m]).join(' or ')} (peak season)` };
  const x = ctx ?? { ...groupLoad(g, k, k + days, c.id), k0: k };
  for (const key of groupsOf(c)) {
    const size = (x.size.get(key) ?? 0) + (ctx ? 0 : 1);
    const cap = capOf(pol.maxShare, size);
    const arr = x.load.get(key);
    for (let d = k; d < k + days; d++) {
      const n = arr ? arr[d - x.k0] ?? 0 : 0;
      if (n + 1 > cap) {
        const [fam, role] = key.split('|');
        return { ok: false, hard: false, why: `${n} of ${size} ${fam} ${ROLE_WORD[role]?.[1] ?? role} already away on ${fmtDay(midnight(c.base, d) + 720)} (limit ${Math.round(pol.maxShare * 100)}%)` };
      }
    }
  }
  return { ok: true, hard: false, why: '' };
}

// ---------- requests ----------

/** The first base-local day a new request may start: after the month published next, 3 weeks ahead at the earliest. */
function firstAskDay(g: GameState, c: CrewMember): number {
  const home = g.company.homeBase;
  const today = dayIndex(home, g.now);
  const pub = Math.max(dayIndex(c.base, publishedTo(g)), pubEndDay(home, today + BAL.v09.roster.publishLead));
  return Math.max(pub, dayIndex(c.base, g.now) + L().noticeDays);
}


/** Days the next block asks for, out of `left` (blocks of 5–14; a remainder of 2–4 asked as it is). */
function blockLength(c: CrewMember, left: number, salt: string): number {
  const { minBlock, maxBlock, minLast } = L();
  if (left < minLast) return 0;
  if (left <= maxBlock) return left;
  let len = 7 + Math.floor(hashUnit(`len:${c.id}:${salt}`) * (maxBlock - 6));
  if (left - len < minBlock) len = left - minBlock;
  return Math.max(minBlock, Math.min(maxBlock, len));
}

/**
 * Crew who have leave left ask for a block, about once every two weeks a person (weekly from August), on days they are
 * free as far as they know (no rotation, course or other leave), in a month they like (`pref`, peak months included:
 * those are refused under the default policy). One open request a person. Returns the requests made.
 */
export function askLeave(g: GameState): LeaveRequest[] {
  const reqs = (g.leaveRequests ??= []);
  const S = L();
  const home = g.company.homeBase;
  const today = dayIndex(home, g.now);
  const late = monthOfDay(today) % 12 >= S.lateMonth;
  const open = new Set(reqs.filter((q) => q.status === 'pending').map((q) => q.crewId));
  const made: LeaveRequest[] = [];
  const pol = leavePolicy(g);
  // What crew can see when they ask: how many of their rank are away each day (leave approved, or asked for today).
  const g0 = today + S.noticeDays - 7;
  const g1 = firstDayOf(monthOfDay(today) + S.aheadMonths + 1) + 7;
  let seen: ReturnType<typeof groupLoad> | null = null;
  const seenLoad = () => (seen ??= groupLoad(g, g0, g1));
  const all = Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const c of all) {
    if (c.notice || c.status === 'joining' || open.has(c.id) || (c.leaveAskAt ?? 0) > g.now) continue;
    if (g.now - c.hired < S.afterServiceDays * DAY && c.hired > (g.company.aocAt ?? g.started)) continue;
    if (hashUnit(`ask:${c.id}:${today}`) >= 1 / (late ? S.askLate : S.askEvery)) continue;
    const first = firstAskDay(g, c);
    const last = firstDayOf(monthOfDay(today) + S.aheadMonths + 1);
    if (first >= last) continue;
    // Months in the window with leave left in their year, weighted by liking.
    // Most ask for dates the leave calendar shows open (no peak month, room in their rank); about one in twelve asks for the
    // dates they want regardless (a wedding, school holidays): the rules may refuse those.
    const wish = hashUnit(`wish:${c.id}:${today}`) < S.wish;
    const months: { mk: number; w: number; left: number }[] = [];
    for (let mk = monthOfDay(first); firstDayOf(mk) < last; mk++) {
      if (!wish && pol.blackout.includes(mk % 12)) continue;
      const y = Math.floor(mk / 12);
      const left = leaveBalance(g, c, y).left;
      if (left >= S.minLast) months.push({ mk, w: S.pref[mk % 12] * (1 + left / 15), left });
    }
    if (!months.length) continue;
    const segs = segsOf(g, c);
    const busy = busyDays(c, segs, first, last);
    const tours: [number, number][] = [];
    for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
      if (q.status === 'broken' || q.status === 'done') continue;
      const a = q.tour ? Math.min(q.start, q.tour.from) : q.start;
      const z = q.tour ? Math.max(q.end, q.tour.to) : q.end;
      if (z > g.now) tours.push([dayIndex(c.base, a) - 1, dayIndex(c.base, z - 1) + 2]);
    }
    const keys = groupsOf(c);
    const free = (s: number, len: number) => {
      if (s < first || s + len > last) return false;
      for (let k = s; k < s + len; k++) if (busy.work.has(k) || blockedOn(c, k) || tours.some(([a, z]) => k >= a && k < z)) return false;
      if (!wish) {
        for (let k = s; k < s + len; k++) if (pol.blackout.includes(monthOfDay(k) % 12)) return false;
        const x = seenLoad();
        for (const key of keys) {
          const arr = x.load.get(key);
          const cap = capOf(pol.maxShare, x.size.get(key) ?? 1);
          for (let k = s; k < s + len; k++) if (k < g1 && (arr?.[k - g0] ?? 0) + 1 > cap) return false;
        }
      }
      return true;
    };
    // Pick a month by weight, then the first free start from a liked day in it; next months by weight if none fits.
    const order = [...months];
    let pickW = hashUnit(`mon:${c.id}:${today}`) * order.reduce((n, m) => n + m.w, 0);
    let i0 = 0;
    for (; i0 < order.length - 1 && pickW >= order[i0].w; i0++) pickW -= order[i0].w;
    const tries = [order[i0], ...order.filter((_, i) => i !== i0).sort((a, b) => b.w - a.w || a.mk - b.mk)];
    for (const m of tries) {
      const len = blockLength(c, m.left, `${today}`);
      if (!len) continue;
      const m0 = Math.max(first, firstDayOf(m.mk));
      const m1 = firstDayOf(m.mk + 1);
      const span = Math.max(1, m1 - m0);
      const off0 = Math.floor(hashUnit(`day:${c.id}:${today}`) * span);
      let start = -1;
      for (let i = 0; i < span && start < 0; i++) {
        const s = m0 + ((off0 + i) % span);
        // A block stays in its year (the next year's days are asked for on their own).
        if (Math.floor(monthOfDay(s + len - 1) / 12) !== Math.floor(m.mk / 12)) continue;
        if (free(s, len)) start = s;
      }
      if (start < 0) continue;
      const q: LeaveRequest = { id: `lv-${c.id}-${today}`, crewId: c.id, from: midnight(c.base, start), days: len, made: g.now, status: 'pending', ...(wish ? { wish: true as const } : {}) };
      reqs.push(q);
      made.push(q);
      statsOf(g).asked++;
      // The next crew member asking today sees these days taken.
      const x = seenLoad();
      for (const key of keys) {
        const arr = x.load.get(key) ?? x.load.set(key, new Int16Array(g1 - g0)).get(key)!;
        for (let k = start; k < start + len && k < g1; k++) if (k >= g0) arr[k - g0]++;
      }
      break;
    }
  }
  return made;
}

/** Approves a request: the leave block goes on the roster (its days off and standby give way) and is booked. */
const statsOf = (g: GameState) => (g.stats.leave ??= { asked: 0, approved: 0, declined: 0, peak: 0, share: 0, byYou: 0, withdrawn: 0 });

function approve(g: GameState, q: LeaveRequest, by: 'rules' | 'you'): void {
  const c = g.crew[q.crewId];
  statsOf(g).approved++;
  q.status = 'approved';
  q.decided = g.now;
  q.by = by;
  delete q.why;
  if (!c) return;
  const k = dayIndex(c.base, q.from);
  (c.blocks ??= []).push({ from: midnight(c.base, k), to: midnight(c.base, k + q.days), why: 'leave', annual: true });
  for (const y of new Set([yearOf(midnight(c.base, k) + 720), yearOf(midnight(c.base, k + q.days - 1) + 720)])) leaveYearOf(g, c, y, true).booked += daysInYear(c, q.from, q.days, y);
  removeOff(c, Array.from({ length: q.days }, (_, i) => k + i));
  clearDays(g, c, k, k + q.days);
  touchCrewState(g);
}

function decline(g: GameState, q: LeaveRequest, by: 'rules' | 'you', why: string): void {
  const c = g.crew[q.crewId];
  const st = statsOf(g);
  st.declined++;
  if (by === 'you') st.byYou++;
  else if (/^No leave in/.test(why)) st.peak++;
  else st.share++;
  q.status = 'declined';
  q.decided = g.now;
  q.by = by;
  q.why = why;
  if (!c) return;
  moraleShock(g, c, 'leave', L().declined);
  c.leaveAskAt = g.now + L().cooldown * DAY;
}

/** The day a pending request must be decided by: the day before its month's roster is worked out (the 12th). */
export function decideBy(g: GameState, q: LeaveRequest): Minute {
  const c = g.crew[q.crewId];
  const k = dayIndex(c?.base ?? g.company.homeBase, q.from);
  const home = g.company.homeBase;
  return midnight(home, firstDayOf(monthOfDay(k) - 1) + BAL.v09.roster.publishDay - 1 - BAL.v09.roster.publishLead);
}

/**
 * Daily: requests decided by the rules (with the auto policy, those made before today; else those whose month is about
 * to be planned), then new requests. Decided ones are kept 60 days for the Leave view. Returns what was decided.
 */
export function dailyLeave(g: GameState): { approved: number; declined: number } {
  const reqs = (g.leaveRequests ??= []);
  const pol = leavePolicy(g);
  const out = { approved: 0, declined: 0 };
  for (const q of reqs) {
    if (q.status !== 'pending') continue;
    const c = g.crew[q.crewId];
    if (!c || c.notice) {
      q.status = 'withdrawn';
      q.decided = g.now;
      continue;
    }
    if (pol.auto ? dayIndex(g.company.homeBase, q.made) >= dayIndex(g.company.homeBase, g.now) : decideBy(g, q) > g.now) continue;
    const v = leaveVerdict(g, c, q.from, q.days, q);
    if (v.ok) {
      approve(g, q, 'rules');
      out.approved++;
    } else if (v.hard) {
      // Work planned since they asked (a rotation, a trip): withdrawn, no refusal; they ask again for other dates.
      q.status = 'withdrawn';
      q.decided = g.now;
      q.by = 'rules';
      q.why = v.why;
      statsOf(g).withdrawn++;
    } else {
      decline(g, q, 'rules', v.why);
      out.declined++;
    }
  }
  const made = askLeave(g);
  if (!pol.auto && made.length) {
    const n = reqs.filter((q) => q.status === 'pending').length;
    pushMessage(g, { tone: 'info', cat: 'crew', title: `${made.length} new leave request${made.length > 1 ? 's' : ''}`, body: `${n} waiting in Crew › Leave. What you leave open is decided by the rules when its month's roster is planned.` });
  }
  g.leaveRequests = reqs.filter((q) => q.status === 'pending' || (q.decided ?? g.now) > g.now - 60 * DAY);
  return out;
}

/** The player's answer to a request: approve (the rules may be overridden, not a hard limit) or decline. */
export function answerLeave(g: GameState, id: string, yes: boolean): ActionResult {
  const q = g.leaveRequests?.find((x) => x.id === id);
  if (!q || q.status !== 'pending') return { ok: false, error: 'This request is no longer open.' };
  const c = g.crew[q.crewId];
  if (!c) return { ok: false, error: 'They have left the company.' };
  const who = `${c.first} ${c.last}`;
  if (!yes) {
    decline(g, q, 'you', 'Declined by operations');
    return { ok: true, msg: `Leave declined: ${who}` };
  }
  const v = leaveVerdict(g, c, q.from, q.days, q);
  if (v.hard) return { ok: false, error: v.why };
  approve(g, q, 'you');
  return { ok: true, msg: `Leave approved: ${who}, ${q.days} days from ${fmtDay(q.from + 720)}` };
}

/** v0.18.1 Company › leave policy changes. */
export function setLeavePolicy(g: GameState, p: Partial<LeavePolicy>): ActionResult {
  const pol = leavePolicy(g);
  if (p.auto !== undefined) pol.auto = p.auto;
  if (p.maxShare !== undefined) pol.maxShare = Math.min(0.25, Math.max(0.04, Math.round(p.maxShare * 100) / 100));
  if (p.blackout) pol.blackout = [...new Set(p.blackout.filter((m) => m >= 0 && m < 12))].sort((a, b) => a - b);
  return { ok: true };
}

// ---------- older saves ----------

/**
 * Load: a save from before requests keeps every leave block it has (approved by the old planner) and books them; the
 * year it planned in full counts as its old 28 days (pro rata), so a Portuguese crew member has 2 days left to ask
 * for. A year's blocks still to come beyond the published roster that run over the allowance are cut back from the
 * latest, never inside the published roster. One message.
 */
export function leaveLoad(g: GameState): void {
  if (g.leaveRequests) return;
  g.leaveRequests = [];
  leavePolicy(g);
  if (!g.dayPlan) return;
  const y = yearOf(g.now);
  const pub = publishedTo(g);
  for (const c of Object.values(g.crew)) {
    if (c.leaveYears) continue;
    for (const yy of [y, y + 1]) {
      const r = leaveYearOf(g, c, yy, true);
      const blocks = (c.blocks ?? []).filter((b) => b.why === 'leave' && b.annual).sort((a, b) => a.from - b.from);
      let days = 0;
      for (const b of blocks) days += daysInYear(c, b.from, Math.round((b.to - b.from) / DAY), yy);
      // The old planner's year: 28 days pro rata, taken or still to come.
      const planned = (c.leaveYear ?? 0) >= yy ? Math.round((L().days * r.ent) / Math.max(1, leaveDaysFor(c.base))) : days;
      r.booked = Math.max(days, planned);
      // Over the allowance: the latest blocks beyond the published roster are cut back.
      for (let i = blocks.length - 1; i >= 0 && r.booked > r.ent; i--) {
        const b = blocks[i];
        if (b.from < pub || yearOf(b.from + 720) !== yy) continue;
        const len = Math.round((b.to - b.from) / DAY);
        const cut = Math.min(len, r.booked - r.ent);
        if (cut >= len) c.blocks = c.blocks!.filter((x) => x !== b);
        else b.to -= cut * DAY;
        r.booked -= cut;
      }
    }
  }
  touchCrewState(g);
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: 'Annual leave now goes by request',
    body: `Each crew member has a yearly allowance (${leaveDaysFor(g.company.homeBase)} days at ${g.company.homeBase}), asks for it in blocks of up to two weeks, and operations approve it by the rules in Crew › Leave. Leave already planned stays.`,
  });
}
