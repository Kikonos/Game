// v0.12.1 (Goma, designer decision): when a world closure keeps us from crewing or flying a client's legs, cancelling
// them is force majeure: no compensation, no reliability or relation hit, the hours off the MGH as lostFmMin, and the
// card says so. S1027: CS-TCS stuck at Goma (closed, no crew can be ticketed in), BLU1205/1206 FRA–BOJ dropped on
// 27 Oct "Waiting for crew" with $30K compensation each pair. Our own crew shortages at open airports still pay.

import { describe, expect, it } from 'vitest';
import { TPL_BY_ID } from '../../data/worldEvents';
import { acceptOffer } from '../contracts';
import { statsV08 } from '../contracts/relations';
import { hamBase, legsOffer, newGame, owned } from '../contracts/testkit';
import { addFlight, flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState, LedgerCat } from '../core/types';
import { applyCrewFix, crewControl } from '../crew';
import { autoRoster } from '../crew/roster';
import { advanceTo } from '../sim';
import { resolveDecision } from './events';
import { delayChain, underClosure } from './flights';
import { closedAirport, closureCause, startEvent } from './world';

const line = (g: GameState, cat: LedgerCat) => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);

/** An aircraft at Madrid with an empty leg home now, a Lisbon charter after it; with `closed`, a strike shuts Madrid. */
function stuck(closed: boolean) {
  const g = newGame(41);
  if (!g.company.approvals.includes('etops120')) g.company.approvals.push('etops120');
  const ac = owned(g);
  ac.at = 'MAD';
  const t = g.now + 8 * 60;
  const r = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', t], ['PMI', 'LIS', t + 300]]).id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  for (const f of flightsOf(g, ac.id)) if (f.kind === 'positioning') f.status = 'cancelled';
  const e = closed ? startEvent(g, { ...TPL_BY_ID.airspaceIraq, id: 'madClosed', kind: 'strike', at: 'MAD', country: 'ES', zoneId: undefined, closeP: 0, airportDays: [3, 3], days: [3, 3], title: 'Strike closes Madrid', body: '' }) : null;
  // The empty leg out, as the planner keeps it (the aircraft holds a permit out; no crew can be ticketed in).
  const out = addFlight(g, { no: 'XX1', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'MAD', to: 'LIS', std: g.now + 30, sta: g.now + 100 });
  const legs = Object.values(g.flights).filter((f) => f.contractId === r.data!.contractId && f.kind === 'revenue');
  return { g, ac, out, e, legs, c: g.contracts[r.data!.contractId] };
}

describe('v0.12.1 (Goma) a world closure that keeps the crew out is force majeure', () => {
  it('the cause: the departure airport closed (the crew\'s only way in), not a shortage at an open airport', () => {
    const a = stuck(true);
    expect(closedAirport(a.g, 'MAD')?.id).toBe(a.e!.id);
    expect(closureCause(a.g, a.out)?.id).toBe(a.e!.id);
    // The charter's own legs leave Lisbon and Palma, both open: no closure is theirs.
    for (const f of a.legs) expect(closureCause(a.g, f)).toBeNull();
    const b = stuck(false);
    expect(closureCause(b.g, b.out)).toBeNull();
  });

  it('a crew wait out of a closed airport drops the next job free of compensation and reliability; at an open one it pays', () => {
    const fm = stuck(true);
    const pen0 = line(fm.g, 'penalties');
    const rel0 = fm.g.company.reputation.reliable;
    const n0 = statsV08(fm.g).legsFm;
    underClosure(fm.g, fm.out, () => delayChain(fm.g, fm.out, fm.g.now + 2 * DAY, 'Waiting for crew', true, true));
    expect(fm.legs.every((f) => fm.g.flights[f.id].status === 'cancelled')).toBe(true);
    for (const f of fm.legs) expect(fm.g.flights[f.id].delayReason).toBe('Cancelled: Strike closes Madrid');
    expect(line(fm.g, 'penalties')).toBe(pen0);
    expect(fm.g.company.reputation.reliable).toBe(rel0);
    expect(statsV08(fm.g).legsFm).toBe(n0 + 2);
    const msg = fm.g.messages.find((m) => /legs cancelled/.test(m.title))!;
    expect(msg.title).toMatch(/\(force majeure\)/);
    expect(msg.body).toMatch(/^Strike closes Madrid: .*Force majeure: no compensation and no reliability hit\.$/);
    // The empty leg out goes with the job it was for (the schedule plans the way on again later).
    expect(fm.out.status).toBe('cancelled');

    const own = stuck(false);
    const p1 = line(own.g, 'penalties');
    underClosure(own.g, own.out, () => delayChain(own.g, own.out, own.g.now + 2 * DAY, 'Waiting for crew', true, true));
    const cancelled = own.legs.filter((f) => own.g.flights[f.id].status === 'cancelled' || own.g.flights[f.id].operatedBy);
    expect(cancelled.length).toBe(2);
    // Our own shortage: compensation, or a sub-charter at our cost.
    expect(line(own.g, 'penalties') + line(own.g, 'subcharter' as LedgerCat)).toBeLessThan(p1);
    expect(own.g.messages.some((m) => /force majeure/.test(m.title + m.body))).toBe(false);
  });

  it('Crew Control and the crew-short card offer the cancel as force majeure there', () => {
    const { g, out } = stuck(true);
    autoRoster(g);
    const v = crewControl(g, out.id);
    const cancel = v?.solutions.find((s) => s.id === 'cancel');
    expect(cancel?.chips[0]).toBe('Force majeure');
    expect(cancel?.desc).toBe('Force majeure (Strike closes Madrid): no compensation and no reliability hit.');
    expect(cancel?.cost).toBe(0);
    // The card shows no ride into the closed airport, and says why.
    expect(v?.card.why).toMatch(/^Madrid is closed \(Strike closes Madrid\) until .+: no crew can be flown in/);
    expect(v?.card.visuals.reach).toBeUndefined();
  });

  it('under the event\'s permit the aircraft may leave, but the card still says no crew can be flown in', () => {
    const { g, out, e, c } = stuck(true);
    // The relief job that flew it in holds the event's permit; its leg in landed just before the empty leg out.
    c.eventId = e!.id;
    c.archetype = 'evacuation';
    const inbound = addFlight(g, { no: 'XX0', aircraftId: out.aircraftId!, contractId: c.id, kind: 'revenue', from: 'LIS', to: 'MAD', std: g.now - 200, sta: g.now - 60 });
    inbound.status = 'done';
    autoRoster(g);
    expect(closureCause(g, out)?.id).toBe(e!.id);
    const v = crewControl(g, out.id);
    expect(v?.card.why).toMatch(/^Madrid is closed \(Strike closes Madrid\) until .+: no crew can be flown in before then; only crew already there can take XX1 out\.$/);
    expect(v?.card.visuals.reach).toBeUndefined();
    // Applied: nothing paid, the job's legs off as force majeure, and the note says so.
    const pen0 = line(g, 'penalties');
    const rel0 = g.company.reputation.reliable;
    expect(applyCrewFix(g, out.id, 'cancel', { confirmed: true }).ok).toBe(true);
    expect(line(g, 'penalties')).toBe(pen0);
    expect(g.company.reputation.reliable).toBe(rel0);
    expect(g.messages[0].body).toMatch(/Force majeure \(Strike closes Madrid\): no compensation and no reliability hit\.$/);
  });

  it('the stranded card: cancelling the job a closure keeps the aircraft from is force majeure (off the MGH)', () => {
    const g = newGame(49);
    if (!g.company.approvals.includes('etops120')) g.company.approvals.push('etops120');
    const ac = owned(g);
    const t = g.now + 2 * DAY;
    const r0 = acceptOffer(g, legsOffer(g, [['LIS', 'EBL', t]]).id, [ac.id]);
    if (!r0.ok) throw new Error(r0.error);
    const f0 = Object.values(g.flights).find((f) => f.contractId === r0.data!.contractId && f.kind === 'revenue')!;
    f0.status = 'done';
    f0.atd = f0.std;
    f0.ata = f0.sta;
    ac.at = 'EBL';
    const r = acceptOffer(g, hamBase(g, t + 2 * DAY, 30, 2).id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    startEvent(g, { ...TPL_BY_ID.warIraq, closeP: 1, days: [8, 8] });
    for (let i = 0; i < 6 * 24 && !g.decisions.some((x) => x.kind === 'stranded'); i++) advanceTo(g, g.now + 60, new Set());
    const d = g.decisions.find((x) => x.kind === 'stranded')!;
    const opt = d.options.find((o) => o.id === 'cancel')!;
    expect(opt.desc).toMatch(/^Force majeure \(.+\): no compensation and no reliability hit\.$/);
    expect(opt.chips?.[0]).toBe('Force majeure');
    const pen0 = line(g, 'penalties');
    const rel0 = g.company.reputation.reliable;
    const res = resolveDecision(g, d.id, 'cancel');
    expect(res.ok && res.msg).toMatch(/cancelled \(force majeure\)$/);
    expect(line(g, 'penalties')).toBe(pen0);
    expect(g.company.reputation.reliable).toBe(rel0);
    const fmMin = Object.values(c.use).reduce((s, u) => s + (u.lostFmMin ?? 0), 0);
    expect(fmMin).toBeGreaterThan(0);
    expect(Object.values(c.use).reduce((s, u) => s + (u.lostMin ?? 0), 0)).toBe(0);
  }, 60_000);
});
