// v0.17 transition and CAMO capacity (UPDATE-0.17.md §G; lane `deals`).
// - The plan (records review, transition check with possible findings, registration alongside, optional paint, the
//   acceptance flight) is rolled on the stream `ind:<offerId>`, so the letter-of-intent dialog shows the same plan as
//   the signing. Findings are rolled with it but told when the check starts.
// - Our CAMO runs 1 + one per 5 aircraft on the AOC transitions at once (at most 4); a widebody takes 2 (or the whole
//   capacity when that is 1); contract tech reps add one slot for their transition and cut its records review by 20 %.
// - Legacy offers (no `source`) and the v0.16 market (`BAL.v017.on` false) keep the legacy lead time.

import { BAL } from '../core/balance';
import { removeFlights, touchFlights } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, pick } from '../core/rng';
import { DAY, fmtDay, yearOf } from '../core/time';
import type { ActionResult, Aircraft, AircraftOffer, GameState, Induction, Minute } from '../core/types';
import { planDeliveryFerry } from '../ops/delivery';
import { leasingSide } from './side';

const I = () => BAL.v017.induction;

export interface InductionPlan {
  /** Handover (in service at the site) after the transition. */
  ready: Minute;
  /** The plan to store on the aircraft (absent: a legacy delivery). */
  induction?: Induction;
  /** When our CAMO has a slot (now when free). */
  camoFreeAt?: Minute;
  /** The ready day the dialog shows (no findings yet). */
  expected?: Minute;
}

const FINDINGS = [
  'Back-to-birth traces missing for two landing-gear parts',
  'Corrosion in the aft cargo hold needs a repair scheme',
  'An airworthiness directive is not signed off in the records',
  'A borescope shows blade damage: an engine module swap',
  'Cabin floor panels and seat tracks need replacing',
  'The last C-check task cards are incomplete',
];

/** Transitions our CAMO can run at once: 1 + one per 5 aircraft on the AOC, at most 4 (§G.2). Pure. */
export function camoCapacity(g: GameState): number {
  const C = I().camo;
  const n = Object.values(g.fleet).filter((a) => a.status !== 'delivering').length;
  return Math.min(C.max, C.base + Math.floor(n / C.perAircraft));
}

const isSpot = (a: Aircraft) => a.ownership.kind === 'dryLeaseIn' && !!a.ownership.spot;

/** The slots a transition takes at a capacity: a widebody 2 (the whole capacity when that is 1), short-term 1. Pure. */
export function camoNeed(wide: boolean, spot: boolean, cap: number): number {
  return wide && !spot ? Math.min(I().camo.wideSlots, cap) : 1;
}

/** Slots in use at `t` (a widebody counts 2, or the whole capacity when that is 1; short-term 1). Pure. */
export function camoLoad(g: GameState, t: Minute = g.now): number {
  const cap = camoCapacity(g);
  let n = 0;
  for (const a of Object.values(g.fleet)) {
    const i = a.induction;
    if (!i || i.slot > t || i.ready <= t) continue;
    n += i.need ?? camoNeed(typeOf(a.typeId).body === 'wide', isSpot(a), cap);
  }
  return n;
}

/** Transitions running (or booked) from `from` on: [slot, ready), the slots each takes, tech reps. */
function booked(g: GameState, from: Minute): { slot: Minute; ready: Minute; need: number; reps: boolean }[] {
  const cap = camoCapacity(g);
  const out: { slot: Minute; ready: Minute; need: number; reps: boolean }[] = [];
  for (const a of Object.values(g.fleet)) {
    const i = a.induction;
    if (!i || i.ready <= from) continue;
    out.push({ slot: i.slot, ready: i.ready, need: i.need ?? camoNeed(typeOf(a.typeId).body === 'wide', isSpot(a), cap), reps: !!i.techReps });
  }
  return out;
}

/** The first time from `from` our CAMO can run a transition of `dur` minutes taking `need` slots (§G.2). Pure. */
export function camoSlot(g: GameState, from: Minute, dur: number, need: number, reps = false): Minute {
  const cap = camoCapacity(g);
  const xs = booked(g, from);
  const fits = (t: Minute) => {
    const points = [t, ...xs.map((x) => x.slot).filter((s) => s > t && s < t + dur)];
    for (const p of points) {
      let load = need;
      let room = cap + (reps ? 1 : 0);
      for (const x of xs) {
        if (x.slot > p || x.ready <= p) continue;
        load += x.need;
        if (x.reps) room++;
      }
      if (load > room) return false;
    }
    return true;
  };
  const cands = [from, ...xs.map((x) => x.ready).filter((r) => r > from)].sort((a, b) => a - b);
  for (const t of cands) if (fits(t)) return t;
  return cands[cands.length - 1];
}

/** When our CAMO next has room for one more transition (now when free) (the dialog's "Our CAMO" row). Pure. */
export function camoFreeAt(g: GameState, wide = false): Minute {
  const cap = camoCapacity(g);
  return camoSlot(g, g.now, DAY, camoNeed(wide, false, cap));
}

/** Whether an offer goes through the v0.17 transition (a `source` set while the v0.17 market is on). Pure. */
export const realTransition = (o: AircraftOffer): boolean => BAL.v017.on && !!o.source;

/**
 * The transition plan of an offer signed now (§G.1), on the stream `ind:<offerId>` (the same plan the letter-of-intent
 * dialog shows before signing). `start`: the earliest start (the lease signing, the aircraft free). Legacy offers: the
 * legacy handover (signing + the offer's lead days). Pure.
 */
export function inductionPlan(g: GameState, o: AircraftOffer, opts: { start?: Minute; techReps?: boolean; paint?: boolean } = {}): InductionPlan {
  if (!realTransition(o)) return { ready: g.now + o.leadDays * DAY };
  const t = typeOf(o.typeId);
  const wide = t.body === 'wide';
  const k = wide ? 'wide' : 'narrow';
  const spot = o.source === 'spot' || !!o.spot;
  const age = Math.max(0, yearOf(g.now) - o.builtYear);
  const old = age >= I().oldFrom;
  const r = leasingSide(g, `ind:${o.id}`);
  // Every number is rolled in the same order whatever the options, so toggling paint or tech reps moves only its own part.
  const rec0 = int(r, I().records[k][0], I().records[k][1]);
  const spotRec = int(r, I().spotRecords[0], I().spotRecords[1]);
  const check0 = int(r, I().check[k][0], I().check[k][1]);
  const reg = int(r, I().reg[0], I().reg[1]);
  const findP = o.newBuild || spot ? 0 : old ? I().findings.old : I().findings[k];
  const found = chance(r, findP);
  const findDays = int(r, I().findings.days[k][0], I().findings.days[k][1]);
  const findText = pick(r, FINDINGS);
  const cap = camoCapacity(g);
  const need = camoNeed(wide, spot, cap);
  const start = Math.max(g.now, opts.start ?? g.now, o.freeAt ?? g.now);
  const acc = I().acceptance * DAY;
  if (o.newBuild) {
    // A new build: the factory acceptance before the slot date; no records review, no check (§G.1).
    const slotDay = Math.max(start, o.freeAt ?? g.now + o.leadDays * DAY);
    const s = slotDay - I().factory * DAY;
    const ready = slotDay;
    const ind: Induction = { slot: s, records: [s, s], check: [s, s], reg: [s, slotDay], ready, waitedCamo: 0, waitedFree: Math.max(0, Math.round((s - g.now) / DAY)), cap, need: 0, expected: ready };
    return { ready, induction: ind, camoFreeAt: s, expected: ready };
  }
  const recDays = spot ? spotRec : Math.round(rec0 * (old ? I().oldX : 1) * (o.source === 'batch' ? BAL.v017.batch.recordsX : 1) * (opts.techReps ? I().techReps.recordsX : 1));
  const checkDays = spot ? 0 : check0;
  const paintDays = opts.paint && !spot ? I().paint[k] : 0;
  const extra = found ? findDays : 0;
  const span = (withFind: number) => Math.max(recDays, (spot ? 0 : recDays / 2) + Math.max(checkDays + withFind + paintDays, reg)) * DAY + acc;
  const slot = camoSlot(g, start, span(extra), need, !!opts.techReps);
  const ready = Math.round(slot + span(extra));
  const expected = Math.round(slot + span(0));
  const cs = slot + (spot ? 0 : Math.round((recDays / 2) * DAY));
  const ce = cs + (checkDays + extra) * DAY;
  const ind: Induction = {
    slot, records: [slot, slot + recDays * DAY], check: [cs, ce], reg: [cs, cs + reg * DAY],
    ...(paintDays ? { paint: [ce, ce + paintDays * DAY] as [Minute, Minute] } : {}),
    ready, ...(found ? { findings: { days: findDays, text: findText } } : {}), ...(opts.techReps ? { techReps: true } : {}),
    waitedCamo: Math.max(0, Math.round((slot - start) / DAY)), waitedFree: Math.max(0, Math.round((start - g.now) / DAY)), cap, need, expected,
  };
  return { ready, induction: ind, camoFreeAt: slot, expected };
}

/** The transition steps as a small timeline for the dialog and the fleet card. Pure. */
export function inductionSteps(i: Induction): { label: string; from: Minute; to: Minute }[] {
  const out: { label: string; from: Minute; to: Minute }[] = [];
  if (i.records[1] > i.records[0]) out.push({ label: 'Records review', from: i.records[0], to: i.records[1] });
  if (i.check[1] > i.check[0]) out.push({ label: i.findings ? 'Transition check (findings)' : 'Transition check', from: i.check[0], to: i.check[1] });
  if (i.reg[1] > i.reg[0]) out.push({ label: 'Registration and insurance', from: i.reg[0], to: i.reg[1] });
  if (i.paint) out.push({ label: 'Paint', from: i.paint[0], to: i.paint[1] });
  out.push({ label: 'Acceptance flight', from: i.ready - I().acceptance * DAY, to: i.ready });
  return out;
}

/** The step a transition is in at `t` ('records' · 'check' · 'paint' · 'acceptance' · 'waiting' for the CAMO · 'done'). Pure. */
export function inductionStep(i: Induction, t: Minute): 'waiting' | 'records' | 'check' | 'paint' | 'acceptance' | 'done' {
  if (t >= i.ready) return 'done';
  if (t < i.slot) return 'waiting';
  if (t < i.records[1] && t < i.check[0]) return 'records';
  if (t < i.check[1]) return 'check';
  if (i.paint && t < i.paint[1]) return 'paint';
  if (t < i.records[1]) return 'records';
  return 'acceptance';
}

/** Whether contract work is booked on the aircraft within `days` of its handover (the findings card is shown then). Pure. */
export function workSoonAfter(g: GameState, ac: Aircraft, t: Minute, days = 21): boolean {
  if (Object.values(g.contracts).some((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id) && c.start < t + days * DAY)) return true;
  for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id && f.contractId && f.status === 'scheduled' && f.std < t + days * DAY) return true;
  return false;
}

/** Daily: transition steps told (quiet), findings told when the check starts (§G.1, §N.4). */
export function dailyInduction(g: GameState, onFindings?: (ac: Aircraft) => boolean): void {
  for (const ac of Object.values(g.fleet)) {
    const i = ac.induction;
    if (!i || ac.status !== 'delivering' || i.ready <= g.now - DAY) continue;
    const told = (i.told ??= []);
    if (i.records[1] > i.records[0] && i.records[1] <= g.now && !told.includes('records')) {
      told.push('records');
      pushMessage(g, { tone: 'info', cat: 'company', topic: 'market', cue: null, title: `Records review done: ${ac.reg}`, body: `The transition check at ${ac.delivery?.where ?? ac.at} ${i.check[1] > g.now ? `runs until ${fmtDay(i.check[1])}` : 'is done'}. Ready ${fmtDay(i.ready)}.`, ref: { kind: 'aircraft', id: ac.id } });
    }
    if (i.findings && i.check[0] <= g.now && !told.includes('findings')) {
      told.push('findings');
      if (!onFindings?.(ac)) {
        pushMessage(g, { tone: 'info', cat: 'company', topic: 'market', cue: null, title: `Transition findings on ${ac.reg}`, body: `${i.findings.text}. Ready ${i.findings.days} days later, ${fmtDay(i.ready)}.`, ref: { kind: 'aircraft', id: ac.id } });
      }
    }
    if (i.check[1] > i.check[0] && i.check[1] <= g.now && !told.includes('check')) {
      told.push('check');
      pushMessage(g, { tone: 'info', cat: 'company', topic: 'market', cue: null, title: `Transition check done: ${ac.reg}`, body: `${i.paint && i.paint[1] > g.now ? `Paint until ${fmtDay(i.paint[1])}, then the` : 'Next the'} acceptance flight; handover ${fmtDay(i.ready)}.`, ref: { kind: 'aircraft', id: ac.id } });
    }
  }
}

/**
 * Moves a transition's handover earlier (tech reps added): the plan's later steps, the handover, the lease start, a
 * new delivery event (the old one finds the aircraft delivered and does nothing) and the delivery ferry re-planned.
 */
function retimeEarlier(g: GameState, ac: Aircraft, shift: number): void {
  const i = ac.induction!;
  if (shift <= 0) return;
  const mv = (x: [Minute, Minute], from: Minute): [Minute, Minute] => [x[0] >= from ? x[0] - shift : x[0], x[1] >= from ? x[1] - shift : x[1]];
  const from = g.now;
  i.check = mv(i.check, from);
  i.reg = mv(i.reg, from);
  if (i.paint) i.paint = mv(i.paint, from);
  i.ready -= shift;
  if (i.expected) i.expected -= shift;
  const dl = ac.delivery;
  if (dl) dl.handover = i.ready;
  ac.deliveredAt = i.ready;
  if (ac.ownership.kind === 'dryLeaseIn') ac.ownership.leaseStart = i.ready;
  schedule(g, i.ready, 'aircraft.delivery', ac.id);
  if (dl) {
    const left = (dl.ferryIds ?? []).filter((id) => g.flights[id]?.status === 'scheduled');
    if (left.length) {
      removeFlights(g, left);
      dl.ferryIds = dl.ferryIds.filter((id) => !left.includes(id));
      planDeliveryFerry(g, ac.id);
    }
  }
  touchFlights(g);
}

/** Contract tech reps on a transition already running (§G.2): −20 % of what is left of the records review, or 5 days off findings. */
export function addTechRepsToInduction(g: GameState, aircraftId: string): ActionResult {
  const ac = g.fleet[aircraftId];
  const i = ac?.induction;
  if (!ac || !i || ac.status !== 'delivering' || i.ready <= g.now) return { ok: false, error: 'No transition running' };
  if (i.techReps) return { ok: false, error: 'Tech reps are already on it' };
  const wide = typeOf(ac.typeId).body === 'wide';
  const cost = I().techReps.cost[wide ? 'wide' : 'narrow'];
  if (g.company.cash < cost) return { ok: false, error: `Not enough cash: ${cost / 1000}K` };
  let shift = 0;
  if (g.now < i.records[1]) {
    const left = i.records[1] - Math.max(g.now, i.records[0]);
    shift = Math.round(left * (1 - I().techReps.recordsX));
    i.records = [i.records[0], i.records[1] - shift];
    // Only what waits on the records moves (the check starts at half of it).
    shift = Math.max(0, Math.min(shift, i.ready - g.now - DAY));
  } else if (i.findings && g.now < i.check[1]) shift = Math.min(5 * DAY, i.check[1] - g.now);
  else return { ok: false, error: 'Too late in the transition for tech reps to help' };
  post(g, 'transition', -cost);
  i.techReps = true;
  retimeEarlier(g, ac, Math.floor(shift / DAY) * DAY);
  return { ok: true, msg: `Tech reps on ${ac.reg} · ready ${fmtDay(i.ready)}` };
}
