// Approvals (progression gates) and policies (B3). DESIGN.md §5.11. v0.7: the Ladder (UPDATE-0.7.md §F8).

import { ACMI_TYPES_LIST, type AcmiType, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, fmtDate } from '../core/time';
import type { ActionResult, Aircraft, ApprovalId, GameState, HotelTier, Minute, PendingApproval, Policies, SimEvent } from '../core/types';
import { clamp } from '../core/util';
import { familyLabel } from '../crew/conversion';
import { restClassAt } from '../crew/crewRest';
import { usd } from './util';

export interface ApprovalDef {
  id: ApprovalId;
  name: string;
  desc: string;
  /** Paid at filing. */
  cost: number;
  /** Paid when the authority grants it (manuals, consultants and the inspection billed over time). */
  grantCost?: number;
  days: number;
  /** Other approvals needed first. */
  requires: ApprovalId[];
}

/** v0.7: the Ladder (rungs 1–4, in ladder order), then the other approvals (RESEARCH §6). */
export const APPROVALS: ApprovalDef[] = [
  { id: 'etops120', name: 'ETOPS 120', desc: 'Twin-engine operations up to 120 minutes from an alternate: the Azores, Cape Verde and the thin North Atlantic on an A321LR.', cost: 250_000, days: 120, requires: [] },
  { id: 'widebody', name: 'Widebody operations', desc: 'The authority accepts widebodies on our AOC: manuals, training, engineering and a widebody type on the operations specification.', cost: 300_000, grantCost: 300_000, days: 120, requires: [] },
  { id: 'etops180', name: 'ETOPS 180', desc: 'The South Atlantic direct and the Indian Ocean. Needs ETOPS 120 held for 120 days.', cost: 350_000, days: 150, requires: ['etops120'] },
  { id: 'augmented', name: 'Long-haul augmented crews', desc: 'Duties over 13 hours with 3–4 pilots and in-flight rest (FDP up to 18 h).', cost: 300_000, days: 90, requires: ['widebody'] },
  { id: 'etops240', name: 'ETOPS 240', desc: 'Remote oceans and the prestige long haul. Needs ETOPS 180 held for 180 days and augmented crews.', cost: 500_000, days: 180, requires: ['etops180', 'augmented'] },
  { id: 'ulr', name: 'Ultra-long-range (FRMS)', desc: 'Sectors over 16 hours with 4 pilots under a fatigue risk management system.', cost: 900_000, days: 180, requires: ['etops240', 'augmented'] },
  { id: 'iosa', name: 'IOSA registration', desc: 'IATA audit many airline clients require. Needs 12 months of operations.', cost: 180_000, days: 240, requires: [] },
  { id: 'dg', name: 'Dangerous goods', desc: 'Weapons, rescue gear, aid cargo and medical oxygen.', cost: 60_000, days: 60, requires: [] },
];

const defOf = (id: ApprovalId) => APPROVALS.find((a) => a.id === id);
const nameOf = (id: ApprovalId) => defOf(id)?.name ?? id;
/** Held, or held for at least `days`. */
const heldDays = (g: GameState, id: ApprovalId): number | null => {
  if (!g.company.approvals.includes(id)) return null;
  return Math.floor((g.now - (g.company.approvalsAt?.[id] ?? g.started)) / DAY);
};

// ---------- requirements ----------

/** Aircraft counted for a fleet requirement: on the AOC, or also delivering. */
const fleetOf = (g: GameState, delivering: boolean): Aircraft[] =>
  Object.values(g.fleet).filter((a) => a.status !== 'stored' && a.status !== 'leasedOut' && !a.returning && (delivering || a.status !== 'delivering'));

/**
 * CPT and FO not on notice who hold the family (actually rated, joined); `booked` adds pilots in planned or running
 * conversion classes to it and rated hires still joining (enough to file Widebody operations, never to be granted it).
 */
export function ratedPilots(g: GameState, families: RatingFamily[], opts: { booked?: boolean } = {}): { CPT: number; FO: number; family: RatingFamily | null } {
  let best = { CPT: 0, FO: 0, family: null as RatingFamily | null };
  for (const fam of families) {
    const n = { CPT: 0, FO: 0 };
    const seen = new Set<string>();
    for (const c of Object.values(g.crew)) {
      if ((c.role !== 'CPT' && c.role !== 'FO') || c.notice || !c.ratings.includes(fam)) continue;
      if (c.status === 'joining' && !opts.booked) continue;
      seen.add(c.id);
      n[c.role]++;
    }
    if (opts.booked) {
      for (const k of Object.values(g.classes ?? {})) {
        if (k.family !== fam || k.group !== 'pilot' || (k.status !== 'planned' && k.status !== 'running')) continue;
        for (const id of k.crewIds) {
          const c = g.crew[id];
          if (!c || seen.has(id) || c.notice || (c.role !== 'CPT' && c.role !== 'FO')) continue;
          seen.add(id);
          n[c.role]++;
        }
      }
    }
    const score = Math.min(n.CPT, n.FO) * 1000 + n.CPT + n.FO;
    if (!best.family || score > Math.min(best.CPT, best.FO) * 1000 + best.CPT + best.FO) best = { ...n, family: fam };
  }
  return best;
}

/** v0.7: an illegal-crew or AOG incident (stats.incidents, pruned after a year); an illegal duty is a finding on pending applications. */
export function noteIncident(g: GameState, kind: 'illegalCrew' | 'aog', why?: string): void {
  const s = g.stats;
  (s.incidents ??= []).push([g.now, kind]);
  if (kind !== 'illegalCrew') return;
  for (const p of g.company.pendingApprovals) {
    if (p.waiting || (p.findings ?? 0) >= BAL.ladder.maxFindings) continue;
    p.findings = (p.findings ?? 0) + 1;
    p.done += BAL.ladder.findingDays * DAY;
    schedule(g, p.done, 'approval.done', p.id);
    s.findings = (s.findings ?? 0) + 1;
    pushMessage(g, {
      tone: 'warn', cat: 'company', title: `${nameOf(p.id)}: authority finding`,
      body: `${why ?? 'A crew member flew outside their limits'} on ${fmtDate(g.now)}. The authority adds ${BAL.ladder.findingDays} days: now due ${fmtDate(p.done)}.`,
    });
  }
}

/** Daily: incidents older than a year drop out of the record. */
export function pruneIncidents(g: GameState): void {
  const keep = g.now - BAL.ladder.incidentKeepDays * DAY;
  if (g.stats.incidents?.length && g.stats.incidents[0][0] < keep) g.stats.incidents = g.stats.incidents.filter(([t]) => t >= keep);
}

/** No illegal-crew incident in the window and AOGs ≤ max(1, aircraft on the AOC × 0.5). Pure. */
export function cleanRecord(g: GameState, days: number): { ok: boolean; text: string } {
  const from = g.now - days * DAY;
  const inc = (g.stats.incidents ?? []).filter(([t]) => t >= from);
  const illegal = inc.filter(([, k]) => k === 'illegalCrew');
  const aogs = inc.filter(([, k]) => k === 'aog').length;
  const maxAog = Math.max(1, Math.floor(fleetOf(g, false).length * BAL.ladder.aogPerAircraft));
  if (illegal.length) return { ok: false, text: `illegal duty ${fmtDate(illegal[illegal.length - 1][0])}` };
  if (aogs > maxAog) return { ok: false, text: `${aogs} AOGs (at most ${maxAog})` };
  const last = (g.stats.incidents ?? []).at(-1);
  return { ok: true, text: last ? `last incident ${fmtDate(last[0])}` : 'no incidents' };
}

const twins = (min: number) => (t: AcmiType) => t.engines === 2 && t.etopsMax >= min;
const wideFamilies = (): RatingFamily[] => [...new Set(ACMI_TYPES_LIST.filter((t) => t.body === 'wide' && t.available).map((t) => t.family))];
const familiesOf = (acs: Aircraft[]): RatingFamily[] => [...new Set(acs.map((a) => typeOf(a.typeId).family))];

interface Req extends ApprovalReq {
  /** Blocker text when it fails. */
  why: string;
  /** Re-checked at the grant (rated crew, clean record). */
  grant?: boolean;
}

function crewReq(g: GameState, fams: RatingFamily[], n: number, booked: boolean, what: string): Req {
  const r = ratedPilots(g, fams, { booked });
  const fam = r.family ? familyLabel(r.family) : what;
  const ok = !!r.family && r.CPT >= n && r.FO >= n;
  const short = r.CPT < n ? `${n} ${fam} captains rated (${r.CPT} now)` : `${n} ${fam} first officers rated (${r.FO} now)`;
  return {
    label: `${n} CPT + ${n} FO rated on ${r.family ? fam : what}${booked ? ' or converting' : ''}`, ok, have: `${r.CPT} + ${r.FO}`, need: `${n} + ${n}`,
    why: fams.length ? `Needs ${short}` : `Needs ${n} + ${n} pilots rated on ${what}`, grant: true,
  };
}

function reliabilityReq(g: GameState, min: number): Req {
  const have = Math.round(g.company.reputation.reliable);
  return { label: `Reliability ${min}`, ok: have >= min, have: `${have}`, need: `${min}`, why: `Needs reliability ${min} (${have} now)` };
}

function cleanReq(g: GameState, days: number): Req {
  const c = cleanRecord(g, days);
  return { label: `Clean record: ${days} days`, ok: c.ok, have: c.text, why: `Needs a clean record for ${days} days (${c.text})`, grant: true };
}

function heldReq(g: GameState, id: ApprovalId, days: number): Req {
  const d = heldDays(g, id);
  return { label: `${nameOf(id)} held ${days} days`, ok: d !== null && d >= days, have: d === null ? 'not held' : `${d} days`, need: `${days} days`, why: d === null ? `Needs ${nameOf(id)} first` : `${nameOf(id)} must be held ${days} days (${d} so far)` };
}

/** Every requirement of an approval (prerequisites first), with the text naming the first failure. Pure. */
function reqsOf(g: GameState, id: ApprovalId, booked: boolean): Req[] {
  const def = defOf(id);
  if (!def) return [];
  const out: Req[] = [];
  const opsDays = Math.floor((g.now - g.started) / DAY);
  const fleet = fleetOf(g, false);
  const fleetD = fleetOf(g, true);
  switch (id) {
    case 'etops120': {
      const acs = fleet.filter((a) => twins(120)(typeOf(a.typeId)));
      out.push({ label: 'An ETOPS-capable twin in the fleet', ok: acs.length > 0, why: 'Needs a twin capable of ETOPS 120' });
      out.push(crewReq(g, familiesOf(acs), 4, false, 'it'));
      out.push(reliabilityReq(g, 60), cleanReq(g, 90));
      break;
    }
    case 'widebody': {
      out.push({ label: '90 days of operations', ok: opsDays >= 90, have: `${opsDays} days`, need: '90 days', why: `Needs 90 days of operations (${opsDays} so far)` });
      out.push(crewReq(g, wideFamilies(), 4, booked, 'a widebody family'));
      out.push(reliabilityReq(g, 62), cleanReq(g, 90));
      break;
    }
    case 'etops180': {
      out.push(heldReq(g, 'etops120', 120));
      const acs = fleetD.filter((a) => twins(180)(typeOf(a.typeId)));
      out.push({ label: 'A 180-capable twin in the fleet or delivering', ok: acs.length > 0, why: 'Needs a twin capable of ETOPS 180' });
      out.push(crewReq(g, familiesOf(acs), 4, false, 'it'));
      out.push(reliabilityReq(g, 65), cleanReq(g, 180));
      break;
    }
    case 'augmented': {
      out.push({ label: 'Widebody operations held', ok: g.company.approvals.includes('widebody'), why: 'Needs Widebody operations first' });
      const acs = fleetD.filter((a) => typeOf(a.typeId).body === 'wide' && restClassAt(g, a.id) !== null);
      out.push({ label: 'A widebody with crew rest in the fleet or delivering', ok: acs.length > 0, why: 'Needs a widebody with a crew rest in the fleet or on order' });
      out.push(crewReq(g, wideFamilies(), 6, false, 'a widebody family'));
      out.push(reliabilityReq(g, 65));
      break;
    }
    case 'etops240': {
      out.push(heldReq(g, 'etops180', 180));
      out.push({ label: 'Augmented crews held', ok: g.company.approvals.includes('augmented'), why: 'Needs Long-haul augmented crews first' });
      const acs = fleet.filter((a) => twins(240)(typeOf(a.typeId)));
      const byFam = new Map<RatingFamily, number>();
      for (const a of acs) byFam.set(typeOf(a.typeId).family, (byFam.get(typeOf(a.typeId).family) ?? 0) + 1);
      const fams = [...byFam].filter(([, n]) => n >= 2).map(([f]) => f);
      out.push({ label: '2 aircraft of an ETOPS 240 type in the fleet', ok: fams.length > 0, have: `${Math.max(0, ...byFam.values())}`, need: '2', why: 'Needs 2 aircraft of an ETOPS 240 type (A330-200, 777, 787, A350)' });
      out.push(crewReq(g, fams, 6, false, 'it'));
      out.push(reliabilityReq(g, 70), cleanReq(g, 180));
      break;
    }
    case 'ulr': {
      out.push({ label: 'ETOPS 240 and augmented crews held', ok: ['etops240', 'augmented'].every((x) => g.company.approvals.includes(x as ApprovalId)), why: 'Needs ETOPS 240 and Long-haul augmented crews first' });
      const n = g.stats.augmentedDuties ?? 0;
      out.push({ label: '20 augmented duties flown', ok: n >= 20, have: `${n}`, need: '20', why: `Needs 20 augmented duties flown (${n} so far)` });
      const acs = fleetD.filter((a) => typeOf(a.typeId).ulr && restClassAt(g, a.id) === 1);
      out.push({ label: 'A ULR-capable aircraft in the fleet or delivering', ok: acs.length > 0, why: 'Needs a ULR-capable aircraft with bunks (class 1 crew rest)' });
      out.push(crewReq(g, familiesOf(acs), 8, false, 'it'));
      out.push(reliabilityReq(g, 75), cleanReq(g, 365));
      break;
    }
    case 'iosa':
      out.push({ label: '12 months of operations', ok: g.now - g.started >= 365 * DAY, have: `${opsDays} days`, need: '365 days', why: 'Needs 12 months of operations' });
      break;
    default:
      break;
  }
  if (id !== 'etops180' && id !== 'etops240' && id !== 'augmented' && id !== 'ulr') {
    const miss = def.requires.filter((r) => !g.company.approvals.includes(r));
    if (miss.length) out.unshift({ label: `${miss.map(nameOf).join(' and ')} held`, ok: false, why: `Needs ${miss.map(nameOf).join(' and ')} first` });
  }
  out.push({ label: `Cash ${usd(def.cost)}`, ok: g.company.cash >= def.cost, have: usd(g.company.cash), need: usd(def.cost), why: `Costs ${usd(def.cost)}` });
  return out;
}

/** v0.7: the requirement checklist of an approval (✓/✗ with have/need). Pure. */
export function approvalReqs(g: GameState, id: ApprovalId): ApprovalReq[] {
  return reqsOf(g, id, id === 'widebody').map(({ label, ok, have, need }) => ({ label, ok, ...(have !== undefined ? { have } : {}), ...(need !== undefined ? { need } : {}) }));
}

/** Why an approval can't be started now (null = it can): the first failing requirement. Pure. */
export function approvalBlocker(g: GameState, id: ApprovalId): string | null {
  const def = defOf(id);
  if (!def) return 'Unknown approval';
  const co = g.company;
  if (co.approvals.includes(id)) return 'Already held';
  if (co.pendingApprovals.some((p) => p.id === id)) return 'In progress';
  return reqsOf(g, id, id === 'widebody').find((r) => !r.ok)?.why ?? null;
}

/** Starts an approval: pays the cost now; granted on 'approval.done' (after the rated-crew and record re-check). */
export function applyApproval(g: GameState, id: ApprovalId): ActionResult {
  const why = approvalBlocker(g, id);
  if (why) return { ok: false, error: why };
  const def = defOf(id)!;
  post(g, 'approvals', -def.cost);
  const done = g.now + def.days * DAY;
  g.company.pendingApprovals.push({ id, started: g.now, done, cost: def.cost });
  schedule(g, done, 'approval.done', id);
  pushMessage(g, { tone: 'info', cat: 'company', title: `${def.name}: application filed`, body: `${usd(def.cost)} paid${def.grantCost ? `; ${usd(def.grantCost)} more at the grant` : ''}. The authority expects to finish by ${fmtDate(done)}.` });
  return { ok: true, msg: `${def.name} under way, done ${fmtDate(done)}` };
}

/** Grant-time re-check: rated crew (actually rated) and the clean record. The first failure's text, or null. */
function grantBlocker(g: GameState, id: ApprovalId): string | null {
  return reqsOf(g, id, false).find((r) => r.grant && !r.ok)?.why ?? null;
}

let grantHook: ((g: GameState, id: ApprovalId) => boolean) | null = null;
/** goals.ts: posts the ladder goal for a granted approval instead of the plain message (true when it did). */
export function setGrantHook(h: (g: GameState, id: ApprovalId) => boolean): void {
  grantHook = h;
}

function grant(g: GameState, i: number): void {
  const co = g.company;
  const [p] = co.pendingApprovals.splice(i, 1);
  if (!co.approvals.includes(p.id)) co.approvals.push(p.id);
  (co.approvalsAt ??= {})[p.id] = g.now;
  const def = defOf(p.id);
  // The second half of a split fee (dev grants and v0.6 aircraft cost nothing).
  if (def?.grantCost && p.cost > 0) post(g, 'approvals', -def.grantCost);
  if (grantHook?.(g, p.id)) return;
  pushMessage(g, { tone: 'good', cat: 'company', title: `${def?.name ?? p.id} approved`, body: `${def?.desc ?? ''} New work is open to us.` });
}

/** The authority is ready but a requirement fails: one message, re-checked daily. */
function wait(g: GameState, p: PendingApproval, why: string): void {
  const first = !p.waiting;
  p.waiting = why;
  if (!first) return;
  const def = defOf(p.id);
  const pilots = /rated/.test(why);
  const cls = Object.values(g.classes ?? {}).filter((k) => k.group === 'pilot' && (k.status === 'planned' || k.status === 'running')).sort((a, b) => a.end - b.end)[0];
  pushMessage(g, {
    tone: 'warn', cat: 'company', title: `${def?.name ?? p.id} waits for ${pilots ? 'rated pilots' : 'a clean record'}`,
    body: `The authority is ready but ${why.replace(/^Needs /, 'needs ')}.${pilots && cls ? ` The ${cls.no} class finishes on ${fmtDate(cls.end)}.` : ''}`,
  });
}

/** 'approval.done': granted when the rated crew and record still hold, else it waits (re-checked daily). */
export function onApprovalDone(g: GameState, ev: SimEvent): void {
  const co = g.company;
  const i = co.pendingApprovals.findIndex((p) => p.id === ev.id && p.done <= g.now && !p.waiting);
  if (i < 0) return;
  const why = grantBlocker(g, co.pendingApprovals[i].id);
  if (why) return wait(g, co.pendingApprovals[i], why);
  grant(g, i);
}

/** Daily: waiting applications are granted once their requirement is met. */
export function dailyApprovals(g: GameState): void {
  pruneIncidents(g);
  const co = g.company;
  for (let i = co.pendingApprovals.length - 1; i >= 0; i--) {
    const p = co.pendingApprovals[i];
    if (!p.waiting || p.done > g.now) continue;
    const why = grantBlocker(g, p.id);
    if (why) p.waiting = why;
    else grant(g, i);
  }
}

export function setPolicies(g: GameState, patch: Partial<Policies>): ActionResult {
  const p = { ...g.company.policies, ...patch };
  p.extraCabin = clamp(Math.round(p.extraCabin), 0, BAL.crewExtra.cabinMax);
  p.perDiemPct = clamp(Math.round(p.perDiemPct), 80, 150);
  p.hotelTier = ([3, 4, 5].includes(p.hotelTier) ? p.hotelTier : 4) as HotelTier;
  p.rotationWeeks = ([4, 5, 6].includes(p.rotationWeeks) ? p.rotationWeeks : 5) as Policies['rotationWeeks'];
  g.company.policies = p;
  return { ok: true };
}

// ---------- v0.7 the Ladder ----------

export interface ApprovalReq { label: string; ok: boolean; have?: string; need?: string }
export type NodeState = 'held' | 'pending' | 'ready' | 'locked';
export interface LadderNode {
  id: ApprovalId; name: string; desc: string; state: NodeState; cost: number; /** Paid at the grant (0 = none). */ grantCost: number; days: number;
  requires: ApprovalId[]; reqs: ApprovalReq[]; blocker: string | null;
  heldSince: Minute | null; pending: (PendingApproval & { progress: number }) | null;
  unlocksTypes: string[]; unlocksWork: string;
}
export interface LadderRung { index: number; title: string; nodes: LadderNode[] }
export interface AircraftGate { ok: boolean; /** pending approvals count as ok (flies revenue after the grant). */ pending: ApprovalId[]; missing: ApprovalId[]; text: string }

/** Approvals a type tier needs on the AOC (held or pending). */
export function gateApprovals(tier: number): ApprovalId[] {
  if (tier >= 4) return ['etops240', 'augmented'];
  if (tier === 3) return ['widebody', 'augmented', 'etops180'];
  if (tier === 2) return ['widebody'];
  return [];
}

/** Whether a type can be signed (pending approvals count; it flies revenue after the grant). Pure. */
export function aircraftGate(g: GameState, typeId: string): AircraftGate {
  const t = typeOf(typeId);
  const co = g.company;
  const need = gateApprovals(t.tier);
  const pending = need.filter((a) => !co.approvals.includes(a) && co.pendingApprovals.some((p) => p.id === a));
  const missing = need.filter((a) => !co.approvals.includes(a) && !pending.includes(a));
  let text = '';
  if (missing.length) text = `Needs ${missing.map(nameOf).join(' and ')}`;
  else if (pending.length) {
    const due = Math.max(...pending.map((a) => co.pendingApprovals.find((p) => p.id === a)!.done));
    text = `${pending.map(nameOf).join(' and ')} pending (due ${fmtDate(due)}): you can sign; it flies revenue after approval`;
  } else text = need.length ? 'Approved' : 'No approval needed';
  return { ok: !missing.length, pending, missing, text };
}

const UNLOCKS: Partial<Record<ApprovalId, { tier?: number; work: string }>> = {
  etops120: { work: 'Over-water work up to 120 minutes: the Azores, Cape Verde, the thin North Atlantic on an A321LR' },
  widebody: { tier: 2, work: 'Signing 767-300ERs, A330s and A340s; widebody charters and wet leases' },
  etops180: { work: 'The South Atlantic direct and the Indian Ocean' },
  augmented: { tier: 3, work: 'Duties over 13 hours with 3–4 pilots; with ETOPS 180 the 777s and the A380' },
  etops240: { tier: 4, work: 'The 787-9, A350-900 and 777-200LR; prestige long haul' },
  ulr: { work: 'Sectors over 16 hours with 4 pilots: ultra-long-range prestige work' },
};

/** Types a tier unlocks (offered on the market). */
const typesOfTier = (tier: number) => ACMI_TYPES_LIST.filter((t) => t.available && (tier <= 1 ? t.tier <= 1 : t.tier === tier)).map((t) => t.id);

function node(g: GameState, id: ApprovalId): LadderNode {
  const def = defOf(id)!;
  const co = g.company;
  const p = co.pendingApprovals.find((x) => x.id === id);
  const held = co.approvals.includes(id);
  const blocker = held || p ? null : approvalBlocker(g, id);
  const u = UNLOCKS[id];
  return {
    id, name: def.name, desc: def.desc, state: held ? 'held' : p ? 'pending' : blocker ? 'locked' : 'ready', cost: def.cost, grantCost: def.grantCost ?? 0, days: def.days,
    requires: [...def.requires], reqs: approvalReqs(g, id), blocker,
    heldSince: held ? (co.approvalsAt?.[id] ?? g.started) : null,
    pending: p ? { ...p, progress: clamp((g.now - p.started) / Math.max(1, p.done - p.started), 0, 1) } : null,
    unlocksTypes: u?.tier ? typesOfTier(u.tier) : [], unlocksWork: u?.work ?? '',
  };
}

/** The Ladder: rungs 0–4 (rung 0 has no nodes, only the types we start with). Pure. */
export function ladder(g: GameState): LadderRung[] {
  return [
    { index: 0, title: 'Rung 0 · Narrowbody charter & ACMI', nodes: [] },
    { index: 1, title: 'Rung 1 · Over water & widebody', nodes: [node(g, 'etops120'), node(g, 'widebody')] },
    { index: 2, title: 'Rung 2 · Long haul', nodes: [node(g, 'etops180'), node(g, 'augmented')] },
    { index: 3, title: 'Rung 3 · Remote oceans', nodes: [node(g, 'etops240')] },
    { index: 4, title: 'Rung 4 · Ultra long range', nodes: [node(g, 'ulr')] },
  ];
}

/** Rung 0's types (no approval needed). */
export const RUNG0_TYPES = typesOfTier(1);

/** v0.7 dev: grants an approval now (as if the authority finished). */
export function devGrantApproval(g: GameState, id: ApprovalId): void {
  const co = g.company;
  const i = co.pendingApprovals.findIndex((p) => p.id === id);
  if (i >= 0) return grant(g, i);
  co.pendingApprovals.push({ id, started: g.now, done: g.now, cost: 0 });
  grant(g, co.pendingApprovals.length - 1);
}

/**
 * v0.7 load: grant dates for held approvals. Only on the first v0.7 load of a v0.6 save, aircraft already flying keep
 * flying (their gate approvals are granted); later loads never grant (a widebody signed while pending stays pending).
 */
export function loadApprovals(g: GameState): void {
  const co = g.company;
  const firstV07 = co.approvalsAt === undefined;
  co.approvalsAt ??= {};
  for (const id of co.approvals) co.approvalsAt[id] ??= g.started;
  if (!firstV07) {
    g.stats.incidents ??= [];
    return;
  }
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering') continue;
    for (const id of gateApprovals(typeOf(ac.typeId).tier)) {
      if (co.approvals.includes(id) || co.pendingApprovals.some((p) => p.id === id)) continue;
      co.approvals.push(id);
      co.approvalsAt[id] ??= g.started;
      co.pendingApprovals = co.pendingApprovals.filter((p) => p.id !== id);
    }
  }
  g.stats.incidents ??= [];
}
