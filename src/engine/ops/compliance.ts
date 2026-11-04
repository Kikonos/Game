// v0.16 the Compliance Monitoring Manager (UPDATE-0.16.md §F): the nominated post of ORO.GEN.200(a)(6), hired in
// Team › Nominated posts from the start (every AOC has one; until now you covered it yourself). With one, ramp
// inspections find less (ramp.ts reads complianceFactor), the yearly audit's random paperwork finding comes less often,
// Level 2 deadlines are longer and corrective actions cost less; the ramp finding's corrective action reads "The CMM
// adds line-station checks" at half the cost. Paid monthly under 'salaries'. No manager = the game as before.

import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay, monthKey, monthStart } from '../core/time';
import type { ActionResult, ComplianceState, GameState, HeadCandidate, MonthKey } from '../core/types';
import { rollPeople } from '../commercial/people';
import { usdK } from '../commercial/state';
import { lockOf } from '../scenario/rules';

const C = BAL.v016.compliance;

/** The record (created empty on first use: older saves never had one). */
export function complianceState(g: GameState): ComplianceState {
  const s = (g.compliance ??= { hired: null, stats: { rampSaved: 0 } });
  s.stats ??= { rampSaved: 0 };
  return s;
}

/** Load (and new game): the record's defaults (SAVE_VERSION stays 1). */
export function loadCompliance(g: GameState): void {
  complianceState(g);
}

const BLURBS = [
  'Quality auditor at a regional airline; knows the ramp inspection checklist by heart.',
  'Ran compliance monitoring for a charter operator through two authority audits without a Level 1.',
  'Former authority inspector; the auditors know and trust the files this person keeps.',
];

/** Days until candidates come back after a dismissal (0 when they are there). Pure. */
export const complianceRehireDays = (g: GameState): number => (g.compliance?.firedAt === undefined ? 0 : Math.max(0, Math.ceil((g.compliance.firedAt + C.rehireDays * DAY - g.now) / DAY)));

/** Candidates (junior, mid, senior), rolled on first look and kept until one is hired; none for 30 days after a dismissal. */
export function complianceCandidates(g: GameState): HeadCandidate[] {
  const s = complianceState(g);
  if (s.hired) return [];
  if (complianceRehireDays(g) > 0) return [];
  return (s.candidates ??= rollPeople(g, `cmm:${s.firedAt ?? 0}`, C.tiers, C.salary, BLURBS));
}

export function hireComplianceManager(g: GameState, candidate: number): ActionResult {
  const lock = lockOf(g, 'hiring');
  if (lock) return { ok: false, error: lock };
  const s = complianceState(g);
  if (s.hired) return { ok: false, error: `${s.hired.name} holds the post` };
  const k = complianceCandidates(g)[candidate];
  if (!k) return { ok: false, error: 'No such candidate' };
  s.hired = { name: k.name, skill: k.skill, salary: k.salary, since: g.now, joins: g.now + C.joinDays * DAY };
  delete s.candidates;
  pushMessage(g, {
    tone: 'good', cat: 'company', title: `${k.name} joins as Compliance Monitoring Manager`,
    body: `Starts ${fmtDay(s.hired.joins)} at ${usdK(k.salary)} a month. From then: about ${Math.round(C.rampCut * k.skill * 100)} % fewer ramp findings, fewer audit paperwork findings, ${C.deadlinePlusDays} more days on Level 2 deadlines, corrective actions ${Math.round((1 - C.taskCostX) * 100)} % cheaper.`,
    ref: { kind: 'compliance', id: 'cmm' }, cue: 'headHired',
  });
  return { ok: true, msg: `${k.name} joins on ${fmtDay(s.hired.joins)}.` };
}

export function fireComplianceManager(g: GameState): ActionResult {
  const s = complianceState(g);
  const h = s.hired;
  if (!h) return { ok: false, error: 'Nobody holds the post' };
  const severance = Math.round(h.salary * C.severanceMonths);
  post(g, 'salaries', -severance);
  s.hired = null;
  s.firedAt = g.now;
  delete s.candidates;
  pushMessage(g, { tone: 'info', cat: 'company', title: `${h.name} has left`, body: `One month's salary in severance (${usdK(severance)}). You cover compliance monitoring yourself again; new candidates in ${C.rehireDays} days.`, ref: { kind: 'compliance', id: 'cmm' } });
  return { ok: true, msg: `${h.name} has left. Severance ${usdK(severance)}.` };
}

/** The manager's pay for month k, pro-rated from the day they joined (month-end bill and forecast alike). Pure. */
export function complianceBill(g: GameState, k: MonthKey = monthKey(g.now)): number {
  const h = g.compliance?.hired;
  if (!h) return 0;
  const a = monthStart(k), b = monthStart(k + 1);
  const from = Math.max(a, h.joins);
  return from < b ? Math.round(h.salary * ((b - from) / (b - a))) : 0;
}

/** The manager at work (hired and joined). Pure. */
const working = (g: GameState) => {
  const h = g.compliance?.hired;
  return h && h.joins <= g.now ? h : null;
};

/** Ramp finding mean × this (1 without a manager, or before they join). Pure. */
export function complianceFactor(g: GameState): number {
  const h = working(g);
  return h ? 1 - C.rampCut * h.skill : 1;
}

/** The audit's random paperwork finding × this. Pure. */
export function complianceAuditFactor(g: GameState): number {
  const h = working(g);
  return h ? 1 - C.auditCut * h.skill : 1;
}

/** Extra days on a Level 2 deadline. Pure. */
export const complianceDeadlinePlus = (g: GameState): number => (working(g) ? C.deadlinePlusDays : 0);

/** Corrective actions' cost × this. Pure. */
export const complianceTaskCostX = (g: GameState): number => (working(g) ? C.taskCostX : 1);

/** The ramp finding's corrective action: hire a compliance officer for the stations, or the CMM's own checks at half the cost. Pure. */
export function rampTaskFor(g: GameState, task: string, cost: number): { label: string; cost: number } {
  return working(g) ? { label: 'The CMM adds line-station checks', cost: Math.round(cost * C.rampTaskCostX) } : { label: task, cost };
}

/** Expected findings an inspection would have shown without the manager, counted (stats). */
export function noteRampSaved(g: GameState, expectedWithout: number): void {
  const f = complianceFactor(g);
  if (f >= 1) return;
  const s = complianceState(g);
  s.stats.rampSaved = Math.round((s.stats.rampSaved + expectedWithout * (1 - f)) * 100) / 100;
}

export interface ComplianceView {
  hired: ComplianceState['hired'];
  candidates: HeadCandidate[];
  /** Plain lines on what the post does for us. */
  does: string[];
  /** '30 % fewer ramp findings' once hired. */
  effect: string | null;
  /** 'Joins 14 Dec' / 'Since 3 Mar'. */
  status: string | null;
  /** Days until candidates return after a dismissal. */
  rehireDays: number;
  rampSaved: number;
}

/** Team › Nominated posts. Pure. */
export function complianceView(g: GameState): ComplianceView {
  const s = g.compliance ?? { hired: null, stats: { rampSaved: 0 } };
  const h = s.hired;
  const skill = h?.skill ?? 0;
  return {
    hired: h, candidates: complianceCandidates(g),
    does: [
      'Audits our own stations and paperwork before the authority does',
      `Ramp inspection findings ${Math.round(C.rampCut * 60)}–${Math.round(C.rampCut * 90)} % fewer (skill)`,
      `Fewer audit paperwork findings; Level 2 deadlines +${C.deadlinePlusDays} days; corrective actions ${Math.round((1 - C.taskCostX) * 100)} % cheaper`,
    ],
    effect: h ? `${Math.round(C.rampCut * skill * 100)} % fewer ramp findings` : null,
    status: h ? (h.joins > g.now ? `Joins ${fmtDay(h.joins)}` : `Since ${fmtDay(h.joins)}`) : null,
    rehireDays: complianceRehireDays(g), rampSaved: s.stats?.rampSaved ?? 0,
  };
}

/** Month end (before the statement closes): the manager's pay. */
export function monthlyCompliance(g: GameState): void {
  const pay = complianceBill(g, g.finance.current.month);
  if (pay) post(g, 'salaries', -pay);
}
