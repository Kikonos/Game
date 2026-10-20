// Approvals (progression gates) and policies (B3). DESIGN.md §5.11.

import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, fmtDate } from '../core/time';
import type { ActionResult, ApprovalId, GameState, HotelTier, Policies, SimEvent } from '../core/types';
import { clamp } from '../core/util';
import { usd } from './util';

export interface ApprovalDef {
  id: ApprovalId;
  name: string;
  desc: string;
  cost: number;
  days: number;
  /** Other approvals needed first. */
  requires: ApprovalId[];
}

/** v0.5 subset of RESEARCH §6. */
export const APPROVALS: ApprovalDef[] = [
  { id: 'etops120', name: 'ETOPS 120', desc: 'Twin-engine ops up to 120 min from an alternate: North Atlantic, Cape Verde, Caribbean.', cost: 250_000, days: 180, requires: [] },
  { id: 'etops180', name: 'ETOPS 180', desc: 'Direct South Atlantic, Indian Ocean. Needs ETOPS 120 first.', cost: 350_000, days: 365, requires: ['etops120'] },
  { id: 'augmented', name: 'Augmented crew ops', desc: '3–4 pilot crews with in-flight rest: FDP up to 18 h.', cost: 300_000, days: 60, requires: [] },
  { id: 'ulr', name: 'Ultra-long-range (FRMS)', desc: 'Sectors over 16 h with 4 pilots. Needs augmented ops, ETOPS 180 and a ULR-capable type.', cost: 900_000, days: 270, requires: ['augmented', 'etops180'] },
  { id: 'iosa', name: 'IOSA registration', desc: 'IATA audit many airline clients require. Needs 12 months of operations.', cost: 180_000, days: 240, requires: [] },
  { id: 'dg', name: 'Dangerous goods', desc: 'Weapons, rescue gear, aid cargo and medical oxygen.', cost: 60_000, days: 60, requires: [] },
];

/** Why an approval can't be started now (null = it can). Pure. */
export function approvalBlocker(g: GameState, id: ApprovalId): string | null {
  const def = APPROVALS.find((a) => a.id === id);
  if (!def) return 'Unknown approval';
  const co = g.company;
  if (co.approvals.includes(id)) return 'Already held';
  if (co.pendingApprovals.some((p) => p.id === id)) return 'In progress';
  const miss = def.requires.filter((r) => !co.approvals.includes(r));
  if (miss.length) return `Needs ${miss.map((r) => APPROVALS.find((a) => a.id === r)?.name ?? r).join(' and ')} first`;
  const types = Object.values(g.fleet).map((a) => typeOf(a.typeId));
  if (id === 'etops120' && !types.some((t) => t.engines === 2 && t.etopsMax >= 120)) return 'Needs a twin capable of ETOPS 120';
  if (id === 'etops180' && !types.some((t) => t.engines === 2 && t.etopsMax >= 180)) return 'Needs a twin capable of ETOPS 180';
  if (id === 'ulr' && !types.some((t) => t.ulr)) return 'Needs a ULR-capable aircraft';
  if (id === 'iosa' && g.now - g.started < 365 * DAY) return 'Needs 12 months of operations';
  if (co.cash < def.cost) return `Costs ${usd(def.cost)}`;
  return null;
}

/** Starts an approval: pays the cost now; granted on 'approval.done'. */
export function applyApproval(g: GameState, id: ApprovalId): ActionResult {
  const why = approvalBlocker(g, id);
  if (why) return { ok: false, error: why };
  const def = APPROVALS.find((a) => a.id === id)!;
  post(g, 'approvals', -def.cost);
  const done = g.now + def.days * DAY;
  g.company.pendingApprovals.push({ id, started: g.now, done, cost: def.cost });
  schedule(g, done, 'approval.done', id);
  pushMessage(g, { tone: 'info', cat: 'company', title: `${def.name}: application filed`, body: `${usd(def.cost)} paid. The authority expects to finish by ${fmtDate(done)}.` });
  return { ok: true, msg: `${def.name} under way, done ${fmtDate(done)}` };
}

/** 'approval.done': the approval is granted. */
export function onApprovalDone(g: GameState, ev: SimEvent): void {
  const co = g.company;
  const i = co.pendingApprovals.findIndex((p) => p.id === ev.id && p.done <= g.now);
  if (i < 0) return;
  const [p] = co.pendingApprovals.splice(i, 1);
  if (!co.approvals.includes(p.id)) co.approvals.push(p.id);
  const def = APPROVALS.find((a) => a.id === p.id);
  pushMessage(g, { tone: 'good', cat: 'company', title: `${def?.name ?? p.id} approved`, body: `${def?.desc ?? ''} New work is open to us.` });
}

export function setPolicies(g: GameState, patch: Partial<Policies>): ActionResult {
  const p = { ...g.company.policies, ...patch };
  p.extraCabin = clamp(Math.round(p.extraCabin), 0, 2);
  p.perDiemPct = clamp(Math.round(p.perDiemPct), 80, 150);
  p.hotelTier = ([3, 4, 5].includes(p.hotelTier) ? p.hotelTier : 4) as HotelTier;
  p.rotationWeeks = ([4, 5, 6].includes(p.rotationWeeks) ? p.rotationWeeks : 5) as Policies['rotationWeeks'];
  g.company.policies = p;
  return { ok: true };
}
