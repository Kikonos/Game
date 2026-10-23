// v0.6 morale & attrition (UPDATE-0.6.md §F3). Morale (0–100 per crew member) drifts toward a target set by the
// company's per-diem and tour policies, and moves with roster life: hotels, long tours, days off away, workload,
// late-notice changes, missions, extra crew, careers and late salaries. Low morale brings sick calls, worse
// service and resignations with notice. Daily from the crew module; read APIs are pure.

import { BAL } from '../core/balance';
import { bumpClient } from '../contracts/relations';
import { pushMessage } from '../core/messages';
import { complement, isPilot } from '../core/perf';
import { DAY, fmtDate } from '../core/time';
import type { Contract, CrewMember, Flight, GameState, Minute, MoraleDriver, Pairing, Policies, Role } from '../core/types';
import { clamp, hash } from '../core/util';
import { aboveMinimum } from './duties';
import { crewName } from './generate';
import { crewIx, touchCrew } from './timeline';

export interface MoraleDriverView {
  key: MoraleDriver;
  label: string;
  value: number;
}

export interface MoraleView {
  value: number;
  target: number;
  trend14d: number;
  drivers: MoraleDriverView[];
  sickMult: number;
  resignPerMonth: number;
  leaves: Minute | null;
}

export interface MoraleSummary {
  avg: number;
  pilots: number;
  cabin: number;
  trend: number;
  low: number;
  leaving: number;
  target: number;
  drivers: MoraleDriverView[];
}

export const MORALE_LABEL: Record<MoraleDriver, string> = {
  policy: 'Pay & tours', hotel: 'Hotels', tour: 'Long tour', offAway: 'Days off away', workload: 'Workload', lateChange: 'Late changes',
  discretion: 'Extended duties', mission: 'Missions', extraCrew: 'Extra crew', career: 'New type', pay: 'Pay', recognition: 'Client thanks',
  standby: 'Long standby runs', daysOff: 'Days off',
};

const M = () => BAL.morale;
const r1 = (v: number) => Math.round(v * 100) / 100;

// ---------- target and risks ----------

/** Morale target from the company policies: 65 + per diem + tour length, clamped 45–80. */
export function moraleTarget(p: Pick<Policies, 'perDiemPct' | 'rotationWeeks'>): number {
  const per = Math.min(M().perDiemMax, (p.perDiemPct - 100) * M().perDiemPerPct);
  const tour = M().tour[p.rotationWeeks] ?? 0;
  return clamp(M().target + per + tour, M().targetClamp[0], M().targetClamp[1]);
}

/** Sick-call multiplier: 1 at 65 or above, ×1.3 at 50, ×1.7 at 30. */
export const sickMult = (m: number) => 1 + Math.max(0, M().sickFrom - m) / M().sickSlope;

/** Resignation multiplier: continuous between the morale points (RESEARCH §9.3), flat beyond the ends. */
export function resignMult(m: number): number {
  const pts = M().resignMult;
  if (m >= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [m1, x1] = pts[i];
    if (m >= m1) {
      const [m0, x0] = pts[i - 1];
      return x1 + ((m - m1) / (m0 - m1)) * (x0 - x1);
    }
  }
  return pts[pts.length - 1][1];
}

/** Monthly resignation chance of a crew member (bonded pilots × bondFactor). */
export function resignChance(g: GameState, c: CrewMember): number {
  if (c.notice) return 0;
  const bond = c.bondUntil !== undefined && c.bondUntil > g.now ? BAL.conv.bondFactor : 1;
  return M().resignPerMonth * resignMult(c.morale) * bond;
}

// ---------- changes ----------

/** Adds a morale change to a crew member and to their 30-day "why" (no change while on notice). */
export function moraleShock(_g: GameState, c: CrewMember | undefined, key: MoraleDriver, delta: number): void {
  if (!c || c.notice || !delta) return;
  c.morale = r1(clamp(c.morale + delta, 0, 100));
  const why = (c.moraleWhy ??= {});
  why[key] = r1((why[key] ?? 0) + delta);
}

/**
 * Late-notice roster change (assigned, unassigned or swapped on a duty reporting within BAL.morale.lateNoticeH):
 * −2, at most once a day per crew member; not in the first days of a new company (the first roster).
 */
export function lateChange(g: GameState, crewId: string, report: Minute | null): void {
  if (report === null || report <= g.now || report - g.now > M().lateNoticeH * 60 || g.now < g.started + 3 * DAY) return;
  const c = g.crew[crewId];
  if (!c || c.notice || c.status === 'joining' || (c.lateAt !== undefined && c.lateAt > g.now - DAY)) return;
  c.lateAt = g.now;
  moraleShock(g, c, 'lateChange', M().lateChange);
}

/** The report of a pairing's next duty still to fly (null when none). */
export function nextReport(g: GameState, p: Pairing): Minute | null {
  let t: Minute | null = null;
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (d && !d.done && d.report > g.now && (t === null || d.report < t)) t = d.report;
  }
  return t;
}

/** Duty released: the extra-crew lift for the group that flew with crew above the minimum, and the mission once per trip. */
export function onDutyMorale(g: GameState, p: Pairing, last: boolean): void {
  const above = aboveMinimum(g, p);
  const cabinAbove = above.cabin > 0;
  const pilotAbove = above.pilots > 0;
  const k = p.contractId ? g.contracts[p.contractId] : undefined;
  const mission = last ? k?.effects.morale ?? 0 : 0;
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    if (isPilot(c.role) ? pilotAbove : cabinAbove) moraleShock(g, c, 'extraCrew', M().extraDuty);
    if (mission) moraleShock(g, c, 'mission', mission);
  }
}

// ---------- service quality ----------

/** Service score of a revenue leg from its operating crew: cabin morale and cabin crew above the legal minimum. */
export function legService(g: GameState, f: Flight): number | null {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac) return null;
  const cabin = f.crewIds.map((id) => g.crew[id]).filter((c): c is CrewMember => !!c && !isPilot(c.role));
  if (!cabin.length) return null;
  const S = M().service;
  const avg = cabin.reduce((s, c) => s + c.morale, 0) / cabin.length;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const legal = complement(ac.typeId, ac.cabin.total, { augment: d?.augment, restCabin: d?.restExtra }).filter((r) => !isPilot(r)).length;
  const above = Math.max(0, cabin.length - legal);
  return clamp((avg - 60) / 30, -1, 1) * S.moraleW + Math.min(S.extraMax, S.extraPer * above);
}

/** Revenue leg landed: its service score joins the contract's accumulator. */
export function noteService(g: GameState, f: Flight): void {
  if (f.kind !== 'revenue' || !f.contractId) return;
  const k = g.contracts[f.contractId];
  const s = legService(g, f);
  if (!k || s === null) return;
  const acc = (k.service ??= { sum: 0, n: 0 });
  acc.sum = Math.round((acc.sum + s) * 1000) / 1000;
  acc.n++;
}

const vipLike = (g: GameState, k: Contract) => k.archetype === 'sports' || k.archetype === 'vip' || ['sports', 'music', 'corporate'].includes(g.clients[k.clientId]?.kind ?? '');

/** Settles a contract's service score into the client relation and reliability (completion; monthly on wet leases). */
export function settleService(g: GameState, k: Contract): number | null {
  const acc = k.service;
  if (!acc || !acc.n) return null;
  const mean = acc.sum / acc.n;
  const S = M().service;
  const cl = g.clients[k.clientId];
  const d = Math.round(mean * S.relation * (vipLike(g, k) ? 2 : 1));
  if (cl && d) bumpClient(g, cl.id, d, d > 0 ? 'Liked the service on board' : 'Did not like the service on board');
  const rep = g.company.reputation;
  rep.reliable = clamp(Math.round((rep.reliable + clamp(mean * S.reliable, -1, 1)) * 100) / 100, 0, 100);
  k.service = { sum: 0, n: 0 };
  return mean;
}

/** Contract completed: service settles; crew who flew it get the client's thanks when it went well. */
export function onContractDoneMorale(g: GameState, k: Contract): void {
  const mean = settleService(g, k);
  const flown = k.legsFlown ?? 0;
  const onTime = flown ? (k.legsOnTime ?? 0) / flown : 0;
  if (mean === null || mean < 0 || onTime < 0.85) return;
  const who = new Set<string>();
  for (const f of Object.values(g.flights)) if (f.contractId === k.id && f.status === 'done' && f.kind !== 'deadhead') for (const id of f.crewIds) who.add(id);
  for (const id of [...who].sort()) moraleShock(g, g.crew[id], 'recognition', M().recognition);
}

// ---------- daily ----------

/** The pairing a crew member is on (or just finished) now. */
function currentPairing(g: GameState, c: CrewMember): Pairing | undefined {
  let best: Pairing | undefined;
  for (const p of crewIx(g).pairingsOf.get(c.id) ?? []) if (p.start <= g.now && (!best || p.start > best.start)) best = p;
  return best;
}

/** Today's driver contributions for one crew member (hotel, tour, days off away, workload, policy pull). */
function dailyDrivers(g: GameState, c: CrewMember, target: number): Partial<Record<MoraleDriver, number>> {
  const out: Partial<Record<MoraleDriver, number>> = {};
  const away = c.awaySince !== null && c.loc !== c.base;
  if (away) {
    const p = currentPairing(g, c);
    const k = p?.contractId ? g.contracts[p.contractId] : undefined;
    const h = k?.product.kind === 'wet' ? 0 : M().hotelDay[g.company.policies.hotelTier] ?? 0;
    if (h) out.hotel = h;
    const days = (g.now - (c.awaySince ?? g.now)) / DAY;
    let t = 0;
    for (const [d, v] of M().awayDays) if (days > d) t = v;
    if (t) out.tour = t;
    // Yesterday without work, at the hotel (v0.9: a hotel standby day is work; long standby runs are their own driver).
    const from = g.now - DAY;
    if ((c.awaySince ?? g.now) <= from && !c.log.some((e) => e.end > from && e.start < g.now) && !c.standby?.some((w) => w.from < g.now && w.to > from)) out.offAway = M().offAway;
  }
  // v0.9 long standby runs (UPDATE-0.9.md §R.6): from the 4th day in a row on standby without a call-out.
  const SR = BAL.v09.roster.morale;
  if (c.standby?.length) {
    let run = 0;
    for (let k = 1; k <= SR.runFrom + 1; k++) {
      const a = g.now - k * DAY;
      const b = a + DAY;
      if (!c.standby.some((w) => w.from >= a && w.from < b && w.calledAt === undefined) || c.log.some((e) => e.end > a && e.start < b)) break;
      run++;
    }
    if (run >= SR.runFrom) out.standby = SR.runDay;
  }
  let duty = 0;
  for (const e of c.log) if (e.end > g.now - 28 * DAY) duty += e.end - e.start;
  if (duty > M().heavy28dH * 60) out.workload = M().heavy;
  // The pull toward the target, shown as the policies' part of it.
  const pol = (target - M().target) * M().revert;
  if (pol) out.policy = pol;
  return out;
}

/** Notice period for a resignation (pilots 60 days, cabin 30). */
const noticeDays = (r: Role) => (isPilot(r) ? M().noticeDays.pilot : M().noticeDays.cabin);

const ROLE_NAME: Record<Role, string> = { CPT: 'captains', FO: 'first officers', CRP: 'relief pilots', PUR: 'pursers', CC: 'cabin crew' };

let resignHook: ((g: GameState, c: CrewMember) => void) | null = null;
let leaveHook: ((g: GameState, c: CrewMember) => void) | null = null;
/** Roster side of a resignation (index.ts): released from work past the leave date; then gone on the day. */
export function setResignHooks(onResign: (g: GameState, c: CrewMember) => void, onLeave: (g: GameState, c: CrewMember) => void): void {
  resignHook = onResign;
  leaveHook = onLeave;
}

/** Top drivers (by size) in a "why" record. */
function topDrivers(why: Partial<Record<MoraleDriver, number>>, n = 3): MoraleDriverView[] {
  return (Object.entries(why) as [MoraleDriver, number][])
    .filter(([, v]) => Math.abs(v) >= 0.5)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([key, v]) => ({ key, label: MORALE_LABEL[key], value: Math.round(v) }));
}

/**
 * Today's resignation roll (bonded pilots less likely): a side draw keyed by seed, crew and day, so the main RNG
 * stream (delays, offers, sickness) is untouched.
 */
export function resignRoll(g: GameState, c: CrewMember): boolean {
  // FNV-1a then a murmur3 finaliser: well spread for keys that differ only in the day.
  let h = hash(`${g.seed}:resign:${c.id}:${Math.floor(g.now / DAY)}`);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296 < resignChance(g, c) / 30;
}

/** Reasons people leave whatever the roster (used when no morale driver stands out). */
const OTHER_REASONS = ['an offer from a Gulf carrier', 'a job closer to family', 'a seniority offer at a legacy airline', 'leaving flying for a ground job', 'moving abroad with a partner'];

/** Resigns now: notice period, work past the leave date released, one inbox message. True when it took effect. */
export function resignNow(g: GameState, crewId: string): boolean {
  const c = g.crew[crewId];
  if (!c || c.notice || c.status === 'joining') return false;
  const leaves = g.now + noticeDays(c.role) * DAY;
  const why = topDrivers(c.moraleWhy ?? {}, 2).filter((d) => d.value < 0).map((d) => d.label.toLowerCase());
  c.notice = { given: g.now, leaves };
  resignHook?.(g, c);
  const fam = c.ratings[0] ?? 'A320';
  const join = (BAL.hireDays as Record<string, number>)[c.role] ?? 45;
  pushMessage(g, {
    tone: 'warn', cat: 'crew', title: `${crewName(c)} (${c.role}) resigned`,
    body: `${noticeDays(c.role)} days' notice: last day ${fmtDate(leaves - 1)}. Morale ${Math.round(c.morale)}: ${why.length ? why.join(', ') : OTHER_REASONS[hash(c.id) % OTHER_REASONS.length]}. Rated ${fam} ${ROLE_NAME[c.role]} take about ${join} days to join: hire now to keep ${BAL.crewSetsPerAircraft} sets.`,
    ref: { kind: 'crew', id: c.id },
  });
  touchCrew(g);
  return true;
}

/** Company average now and 14 days ago, by group (crew still joining are not counted). */
function averages(g: GameState): { avg: number; pilots: number; cabin: number; then: number; n: number } {
  let s = 0;
  let n = 0;
  let sp = 0;
  let np = 0;
  let then = 0;
  for (const c of Object.values(g.crew)) {
    if (c.status === 'joining') continue;
    s += c.morale;
    n++;
    then += c.moraleHist?.[0] ?? c.morale;
    if (isPilot(c.role)) {
      sp += c.morale;
      np++;
    }
  }
  return { avg: n ? s / n : 0, pilots: np ? sp / np : 0, cabin: n - np ? (s - sp) / (n - np) : 0, then: n ? then / n : 0, n };
}

/** v0.9 the company's average crew morale now (null without crew). Pure. */
export function companyMorale(g: GameState): number | null {
  const a = averages(g);
  return a.n ? a.avg : null;
}

/**
 * Daily (crew module): drift toward the target plus the day's drivers (≤ ~2 points a day), the decayed "why",
 * history for the trend, resignation rolls and leave dates, the company weekly average and low-morale message.
 */
export function dailyMorale(g: GameState): void {
  const target = moraleTarget(g.company.policies);
  const decay = M().whyDecay;
  const leaving: CrewMember[] = [];
  for (const c of Object.values(g.crew)) {
    if (c.notice) {
      if (c.notice.leaves <= g.now) leaving.push(c);
      continue;
    }
    if (c.status === 'joining') continue;
    // The 30-day why decays, then today's drivers join it.
    const why = (c.moraleWhy ??= {});
    for (const k of Object.keys(why) as MoraleDriver[]) {
      const v = r1(why[k]! * decay);
      if (Math.abs(v) < 0.05) delete why[k];
      else why[k] = v;
    }
    const drv = dailyDrivers(g, c, target);
    // Drift toward the company target (its policy part is reported as a driver of its own).
    let delta = (target - c.morale) * M().revert;
    for (const [k, v] of Object.entries(drv) as [MoraleDriver, number][]) {
      if (k !== 'policy') delta += v;
      why[k] = r1((why[k] ?? 0) + v);
    }
    c.morale = r1(clamp(c.morale + delta, 0, 100));
    const h = (c.moraleHist ??= []);
    h.push(Math.round(c.morale));
    if (h.length > 15) h.splice(0, h.length - 15);
    if (resignRoll(g, c)) resignNow(g, c.id);
  }
  for (const c of leaving) {
    if (c.status === 'onDuty') continue;
    leaveHook?.(g, c);
    delete g.crew[c.id];
    g.stats.resigned = (g.stats.resigned ?? 0) + 1;
  }
  if (leaving.length) touchCrew(g);
  // Weekly company average (newest last, 12 weeks) and the low-morale warning (rearmed above 55).
  const a = averages(g);
  if (!a.n) return;
  if (Math.floor((g.now - g.started) / DAY) % 7 === 0) {
    const w = (g.stats.moraleWeeks ??= []);
    w.push(r1(a.avg));
    if (w.length > 12) w.splice(0, w.length - 12);
  }
  if (a.avg < 50 && !g.stats.moraleLowWarned) {
    g.stats.moraleLowWarned = true;
    pushMessage(g, { tone: 'warn', cat: 'crew', title: `Crew morale is low (${Math.round(a.avg)})`, body: 'Expect more sick calls and resignations. Better hotels, per diem or shorter tours lift it.' });
  } else if (a.avg > 55 && g.stats.moraleLowWarned) g.stats.moraleLowWarned = false;
}

/** Month end (with the statement): a line when the company average moved 3 or more, or is below 50, or spares covered seats.
 *  v0.8: client relations drift only for idle clients (contracts/relations.ts monthlyRelationDrift). */
export function monthlyMorale(g: GameState): void {
  const a = averages(g);
  const spares = g.stats.sparesCovered ?? 0;
  delete g.stats.sparesCovered;
  if (!a.n) return;
  const w = g.stats.moraleWeeks ?? [];
  const prev = w.length >= 5 ? w[w.length - 5] : null;
  const diff = prev === null ? 0 : a.avg - prev;
  const spareLine = spares ? `Extra crew on board covered ${spares} empty seat${spares > 1 ? 's' : ''} (no tickets, no positioning).` : '';
  if (Math.abs(diff) < 3 && a.avg >= 50) {
    if (spareLine) pushMessage(g, { tone: 'good', cat: 'crew', title: `Extra crew covered ${spares} seat${spares > 1 ? 's' : ''}`, body: `${spareLine} Crew morale ${Math.round(a.avg)}.` });
    return;
  }
  // Where it is lowest: the station with the lowest average away from base.
  const at = new Map<string, { s: number; n: number }>();
  const why: Partial<Record<MoraleDriver, number>> = {};
  for (const c of Object.values(g.crew)) {
    if (c.status === 'joining') continue;
    for (const [k, v] of Object.entries(c.moraleWhy ?? {}) as [MoraleDriver, number][]) why[k] = (why[k] ?? 0) + v / a.n;
    if (c.loc === c.base) continue;
    const x = at.get(c.loc) ?? { s: 0, n: 0 };
    x.s += c.morale;
    x.n++;
    at.set(c.loc, x);
  }
  const low = [...at].filter(([, x]) => x.n >= 3).sort((p, q) => p[1].s / p[1].n - q[1].s / q[1].n || (p[0] < q[0] ? -1 : 1))[0];
  const drv = topDrivers(why, 2).filter((d) => d.value < 0).map((d) => d.label.toLowerCase());
  const p = g.company.policies;
  pushMessage(g, {
    tone: a.avg < 50 || diff <= -3 ? 'warn' : 'info', cat: 'crew',
    title: `Crew morale ${Math.round(a.avg)}${prev === null ? '' : ` (${diff > 0 ? '+' : '−'}${Math.abs(Math.round(diff))})`}`,
    body: `${low ? `Lowest at the ${low[0]} deployment${drv.length ? `: ${drv.join(', ')}` : ''}. ` : drv.length ? `Weighing on it: ${drv.join(', ')}. ` : ''}Per diem ${p.perDiemPct}%, hotels ${p.hotelTier}★, tours ${p.rotationWeeks} weeks.${spareLine ? ` ${spareLine}` : ''}`,
  });
}

/** Salaries paid while cash is negative at month end: −15 across the company, one message. */
export function salariesLate(g: GameState): void {
  for (const c of Object.values(g.crew)) if (c.status !== 'joining') moraleShock(g, c, 'pay', M().salaryLate);
  pushMessage(g, { tone: 'bad', cat: 'crew', title: 'Salaries paid late', body: `Cash was negative at month end. Morale ${M().salaryLate} across the company.` });
}

// ---------- read APIs ----------

/** One crew member's morale: target, 14-day trend, top drivers and risks. Pure. */
export function moraleOf(g: GameState, crewId: string): MoraleView {
  const c = g.crew[crewId];
  const target = moraleTarget(g.company.policies);
  if (!c) return { value: 0, target, trend14d: 0, drivers: [], sickMult: 1, resignPerMonth: 0, leaves: null };
  const h = c.moraleHist ?? [];
  return {
    value: Math.round(c.morale), target, trend14d: h.length ? Math.round(c.morale - h[0]) : 0, drivers: topDrivers(c.moraleWhy ?? {}),
    sickMult: Math.round(sickMult(c.morale) * 100) / 100, resignPerMonth: Math.round(resignChance(g, c) * 10_000) / 10_000, leaves: c.notice?.leaves ?? null,
  };
}

/** Company-wide morale: averages, 14-day trend, crew below 40, on notice, top drivers. Pure. */
export function moraleSummary(g: GameState): MoraleSummary {
  const a = averages(g);
  const why: Partial<Record<MoraleDriver, number>> = {};
  let low = 0;
  let leaving = 0;
  for (const c of Object.values(g.crew)) {
    if (c.notice) leaving++;
    if (c.status === 'joining') continue;
    if (c.morale < 40) low++;
    for (const [k, v] of Object.entries(c.moraleWhy ?? {}) as [MoraleDriver, number][]) why[k] = (why[k] ?? 0) + v / Math.max(1, a.n);
  }
  return {
    avg: Math.round(a.avg), pilots: Math.round(a.pilots), cabin: Math.round(a.cabin), trend: Math.round(a.avg - a.then), low, leaving,
    target: moraleTarget(g.company.policies), drivers: topDrivers(why),
  };
}

/** Crew policy costs per month (per diem, hotels, deadheads): the last closed month, else the month so far scaled up. */
function policyCosts(g: GameState): { perDiem: number; hotels: number; deadhead: number } {
  const last = g.finance.history[g.finance.history.length - 1];
  const st = last ?? g.finance.current;
  const k = last ? 1 : 30.44 / Math.max(1, (g.now - g.started) / DAY);
  const v = (x: number | undefined) => Math.max(0, -(x ?? 0)) * k;
  return { perDiem: v(st.lines.perDiem), hotels: v(st.lines.hotels), deadhead: v(st.lines.deadhead) };
}

/** Morale target and monthly crew policy cost under a policy patch vs now (Company → Policies preview). Pure. */
export function policyPreview(g: GameState, patch: Partial<Policies>): { target: number; targetNow: number; costPerMonth: number; costNow: number } {
  const now = g.company.policies;
  const next = { ...now, ...patch };
  const c = policyCosts(g);
  const night = (t: number) => BAL.hotelPerNight[t] ?? BAL.hotelPerNight[4];
  const costNow = Math.round(c.perDiem + c.hotels + c.deadhead);
  const costPerMonth = Math.round(c.perDiem * (next.perDiemPct / now.perDiemPct) + c.hotels * (night(next.hotelTier) / night(now.hotelTier)) + c.deadhead * (now.rotationWeeks / next.rotationWeeks));
  return { target: moraleTarget(next), targetNow: moraleTarget(now), costPerMonth, costNow };
}
