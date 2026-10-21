// Approvals and policies (B3). DESIGN.md §5.11. v0.7: the Ladder (UPDATE-0.7.md §F8).

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { ApprovalId, HotelTier, Policies } from '../core/types';
import { addAircraft, newGame } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { addCrew } from '../crew/fixtures';
import { aircraftGate, APPROVALS, applyApproval, approvalBlocker, approvalReqs, cleanRecord, gateApprovals, ladder, ratedPilots, setPolicies } from '.';
import { dailyApprovals, devGrantApproval, loadApprovals, noteIncident, onApprovalDone } from './company';

describe('approvals (v0.7 ladder)', () => {
  it('the ladder costs, times and prerequisites (UPDATE-0.7 §F8.1), then IOSA and DG', () => {
    const rows = APPROVALS.map((a) => [a.id, a.cost, a.days, a.requires.join('+')]);
    expect(rows).toEqual([
      ['etops120', 250_000, 120, ''], ['widebody', 600_000, 120, ''], ['etops180', 350_000, 150, 'etops120'], ['augmented', 300_000, 90, 'widebody'],
      ['etops240', 500_000, 180, 'etops180+augmented'], ['ulr', 900_000, 180, 'etops240+augmented'], ['iosa', 180_000, 240, ''], ['dg', 60_000, 60, ''],
    ]);
  });

  it('blockers name the first failing requirement: prerequisites, held-for days, fleet, operations, crew, reliability, record, cash', () => {
    const g = newGame(33);
    expect(approvalBlocker(g, 'etops120')).toBeNull();
    expect(approvalBlocker(g, 'dg')).toBeNull();
    expect(approvalBlocker(g, 'widebody')).toBe('Needs 90 days of operations (0 so far)');
    expect(approvalBlocker(g, 'augmented')).toBe('Needs Widebody operations first');
    expect(approvalBlocker(g, 'etops180')).toBe('Needs ETOPS 120 first');
    expect(approvalBlocker(g, 'etops240')).toBe('Needs ETOPS 180 first');
    expect(approvalBlocker(g, 'ulr')).toBe('Needs ETOPS 240 and Long-haul augmented crews first');
    expect(approvalBlocker(g, 'iosa')).toBe('Needs 12 months of operations');
    expect(approvalBlocker(g, 'nope' as ApprovalId)).toBe('Unknown approval');
    // Reliability and the clean record.
    g.company.reputation.reliable = 55;
    expect(approvalBlocker(g, 'etops120')).toBe('Needs reliability 60 (55 now)');
    g.company.reputation.reliable = 70;
    g.stats.incidents = [[g.now - 10 * DAY, 'illegalCrew']];
    expect(approvalBlocker(g, 'etops120')).toMatch(/^Needs a clean record for 90 days \(illegal duty/);
    g.stats.incidents = [[g.now - 100 * DAY, 'illegalCrew']];
    expect(approvalBlocker(g, 'etops120')).toBeNull();
    // ETOPS 120 held: ETOPS 180 needs 120 days of it, then a 180-capable twin with rated pilots.
    g.company.approvals.push('etops120');
    g.company.approvalsAt = { etops120: g.now - 30 * DAY };
    expect(approvalBlocker(g, 'etops120')).toBe('Already held');
    expect(approvalBlocker(g, 'etops180')).toBe('ETOPS 120 must be held 120 days (30 so far)');
    g.company.approvalsAt.etops120 = g.now - 130 * DAY;
    expect(approvalBlocker(g, 'etops180')).toBe('Needs a twin capable of ETOPS 180');
    g.stats.incidents = [];
    const w = addAircraft(g, 'b763');
    w.status = 'delivering';
    expect(approvalBlocker(g, 'etops180')).toBe('Needs 4 B767 captains rated (0 now)');
    addCrew(g, { CPT: 4, FO: 3 }, 'B757/767');
    expect(approvalBlocker(g, 'etops180')).toBe('Needs 4 B767 first officers rated (3 now)');
    addCrew(g, { FO: 1 }, 'B757/767');
    expect(approvalBlocker(g, 'etops180')).toBeNull();
    // Cash last.
    g.company.cash = 100_000;
    expect(approvalBlocker(g, 'etops180')).toBe('Costs $350K');
    expect(applyApproval(g, 'etops180')).toEqual({ ok: false, error: 'Costs $350K' });
  });

  it('Widebody operations: 90 days, then 4 + 4 pilots rated on or converting to one widebody family (filing only)', () => {
    const g = newGame(36);
    g.now += 91 * DAY;
    g.company.reputation.reliable = 70;
    expect(approvalBlocker(g, 'widebody')).toBe('Needs 4 B767 captains rated (0 now)');
    // Pilots booked on a planned conversion class count for filing…
    const ids = Object.values(g.crew).filter((c) => c.role === 'CPT' || c.role === 'FO').slice(0, 8).map((c) => c.id);
    const cpt = ids.filter((id) => g.crew[id].role === 'CPT').length;
    expect(cpt).toBeGreaterThanOrEqual(4);
    g.classes = { k1: { id: 'k1', no: 'B767-P1', family: 'B757/767', group: 'pilot', course: 'full', start: g.now + 5 * DAY, end: g.now + 47 * DAY, crewIds: ids, costPerHead: 0, status: 'planned' } };
    const pil = ratedPilots(g, ['B757/767'], { booked: true });
    expect(pil.CPT + pil.FO).toBe(8);
    expect(ratedPilots(g, ['B757/767']).CPT).toBe(0);
    const fo = pil.FO;
    if (fo >= 4 && pil.CPT >= 4) expect(approvalBlocker(g, 'widebody')).toBeNull();
    // …and approvalReqs lists the checklist (✓/✗ with have/need).
    const reqs = approvalReqs(g, 'widebody');
    expect(reqs.map((r) => r.label)).toEqual(['90 days of operations', expect.stringMatching(/^4 CPT \+ 4 FO rated on .* or converting$/), 'Reliability 62', 'Clean record: 90 days', 'Cash $600K']);
    expect(reqs[0]).toMatchObject({ ok: true, have: '91 days', need: '90 days' });
  });

  it('filing pays now; a finding adds 30 days (at most 2); the grant waits for rated pilots, then grants with a ladder goal', () => {
    const g = newGame(34);
    g.now += 91 * DAY;
    g.company.reputation.reliable = 70;
    addCrew(g, { CPT: 4, FO: 4 }, 'B757/767');
    expect(approvalBlocker(g, 'widebody')).toBeNull();
    const cash = g.company.cash;
    expect(applyApproval(g, 'widebody').ok).toBe(true);
    expect(g.company.cash).toBe(cash - 600_000);
    const p = g.company.pendingApprovals[0];
    expect(p).toMatchObject({ id: 'widebody', started: g.now, done: g.now + 120 * DAY, cost: 600_000 });
    expect(approvalBlocker(g, 'widebody')).toBe('In progress');
    expect(aircraftGate(g, 'a332')).toMatchObject({ ok: true, pending: ['widebody'], missing: [] });
    expect(aircraftGate(g, 'a332').text).toMatch(/^Widebody operations pending \(due .*\): you can sign; it flies revenue after approval$/);
    // Findings: +30 days twice, the third is ignored.
    const due = p.done;
    for (let i = 0; i < 3; i++) noteIncident(g, 'illegalCrew', 'A duty flew over its FDP');
    expect(p.findings).toBe(2);
    expect(p.done).toBe(due + 60 * DAY);
    expect(g.messages.filter((m) => m.title === 'Widebody operations: authority finding')).toHaveLength(2);
    // The pilots leave the type before the grant: it waits (one message), re-checked daily.
    for (const c of Object.values(g.crew)) if (c.ratings.includes('B757/767') && c.role === 'CPT') c.ratings = ['A320'];
    g.stats.incidents = [];
    const done = (t: number) => {
      g.now = t;
      onApprovalDone(g, { t, seq: 0, type: 'approval.done', id: 'widebody', v: 0 });
    };
    done(p.done - 1);
    expect(p.waiting).toBeUndefined();
    done(p.done);
    expect(g.company.approvals).not.toContain('widebody');
    expect(p.waiting).toBe('Needs 4 B767 captains rated (0 now)');
    expect(g.messages.filter((m) => m.title === 'Widebody operations waits for rated pilots')).toHaveLength(1);
    g.now += DAY;
    dailyApprovals(g);
    done(g.now);
    expect(g.messages.filter((m) => m.title === 'Widebody operations waits for rated pilots')).toHaveLength(1);
    expect(g.company.approvals).not.toContain('widebody');
    addCrew(g, { CPT: 4 }, 'B757/767');
    g.now += DAY;
    dailyApprovals(g);
    expect(g.company.approvals).toContain('widebody');
    expect(g.company.approvalsAt?.widebody).toBeGreaterThan(p.done);
    expect(g.company.pendingApprovals).toHaveLength(0);
    // One message for the grant: the ladder goal (celebration), not a plain "approved".
    const goal = g.messages.filter((m) => m.topic === 'ladder');
    expect(goal.map((m) => m.title)).toEqual(['Goal reached: Widebody operator']);
    expect(goal[0].body).toMatch(/You can now sign 767-300ERs, A330s and A340s/);
    expect(g.messages.some((m) => m.title === 'Widebody operations approved')).toBe(false);
    expect(g.goals.find((x) => x.id === 'widebodyOps')!.done).not.toBeNull();
    // Paid once.
    expect([g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines.approvals ?? 0), 0)).toBe(-600_000);
  });

  it('aircraftGate per tier: narrowbodies open; tier 2 widebody; tier 3 + augmented + ETOPS 180; tier 4 ETOPS 240 + augmented', () => {
    const g = newGame(37);
    expect(aircraftGate(g, 'a320ceo')).toMatchObject({ ok: true, missing: [] });
    expect(aircraftGate(g, 'a321neo').ok).toBe(true);
    expect(aircraftGate(g, 'b763')).toMatchObject({ ok: false, missing: ['widebody'], text: 'Needs Widebody operations' });
    expect(aircraftGate(g, 'b77w')).toMatchObject({ ok: false, missing: ['widebody', 'augmented', 'etops180'] });
    expect(aircraftGate(g, 'a359')).toMatchObject({ ok: false, missing: ['etops240', 'augmented'] });
    g.company.approvals.push('widebody');
    expect(aircraftGate(g, 'a343')).toMatchObject({ ok: true, text: 'Approved' });
    expect(aircraftGate(g, 'b772').missing).toEqual(['augmented', 'etops180']);
    g.company.approvals.push('augmented', 'etops180');
    expect(aircraftGate(g, 'a388').ok).toBe(true);
    g.company.pendingApprovals.push({ id: 'etops240', started: g.now, done: g.now + 180 * DAY, cost: 0 });
    expect(aircraftGate(g, 'b789')).toMatchObject({ ok: true, pending: ['etops240'] });
    expect(gateApprovals(4)).toEqual(['etops240', 'augmented']);
  });

  it('ladder(): five rungs, node states, unlocks; pure', () => {
    const g = newGame(38);
    const before = JSON.stringify(g);
    const l = ladder(g);
    expect(JSON.stringify(g)).toBe(before);
    expect(l.map((r) => r.nodes.map((n) => n.id))).toEqual([[], ['etops120', 'widebody'], ['etops180', 'augmented'], ['etops240'], ['ulr']]);
    const n = Object.fromEntries(l.flatMap((r) => r.nodes).map((x) => [x.id, x]));
    expect(n.etops120.state).toBe('ready');
    expect(n.widebody.state).toBe('locked');
    expect(n.widebody.blocker).toBe('Needs 90 days of operations (0 so far)');
    expect(n.widebody.unlocksTypes).toEqual(['b763', 'a332', 'a333', 'a343']);
    expect(n.augmented.unlocksTypes).toEqual(['b772', 'b77w', 'a388']);
    expect(n.etops240.unlocksTypes).toEqual(['b789', 'a359', 'a35u', 'b77l']);
    expect(applyApproval(g, 'etops120').ok).toBe(true);
    g.now += 60 * DAY;
    const p = ladder(g)[1].nodes[0];
    expect(p.state).toBe('pending');
    expect(p.pending!.progress).toBeCloseTo(0.5);
    devGrantApproval(g, 'etops120');
    const h = ladder(g)[1].nodes[0];
    expect(h).toMatchObject({ state: 'held', heldSince: g.now, pending: null });
  });

  it('old saves: held approvals get a date, aircraft already flying keep their gate approvals', () => {
    const g = newGame(39);
    addAircraft(g, 'b77w');
    g.company.approvals = ['etops120'];
    delete g.company.approvalsAt;
    delete g.stats.incidents;
    loadApprovals(g);
    expect(g.company.approvalsAt).toMatchObject({ etops120: g.started, widebody: g.started, augmented: g.started, etops180: g.started });
    expect(aircraftGate(g, 'b77w').ok).toBe(true);
    expect(g.stats.incidents).toEqual([]);
  });

  it('clean record: illegal duties in the window fail it; AOGs up to max(1, fleet × 0.5); incidents older than a year are pruned', () => {
    const g = newGame(40);
    expect(cleanRecord(g, 90)).toMatchObject({ ok: true, text: 'no incidents' });
    g.stats.incidents = [[g.now - 200 * DAY, 'illegalCrew'], [g.now - 5 * DAY, 'aog']];
    expect(cleanRecord(g, 90).ok).toBe(true);
    expect(cleanRecord(g, 365).ok).toBe(false);
    g.stats.incidents.push([g.now - 4 * DAY, 'aog']);
    expect(cleanRecord(g, 90)).toMatchObject({ ok: false, text: '2 AOGs (at most 1)' });
    g.now += 400 * DAY;
    advanceTo(g, g.now + 1, new Set());
    expect(g.stats.incidents.length).toBeLessThan(3);
  });
});

describe('policies', () => {
  it('setPolicies clamps every field to its range', () => {
    const g = newGame(35);
    expect(setPolicies(g, { perDiemPct: 300, extraCabin: 5.4, hotelTier: 7 as HotelTier, rotationWeeks: 9 as Policies['rotationWeeks'] }).ok).toBe(true);
    expect(g.company.policies).toMatchObject({ perDiemPct: 150, extraCabin: 4, hotelTier: 4, rotationWeeks: 5 });
    setPolicies(g, { perDiemPct: 10, extraCabin: -1, hotelTier: 5, rotationWeeks: 4, autoRoster: false, allowTight: true });
    expect(g.company.policies).toMatchObject({ perDiemPct: 80, extraCabin: 0, hotelTier: 5, rotationWeeks: 4, autoRoster: false, allowTight: true, autoMaintenance: true, autoDeadhead: true });
    setPolicies(g, { perDiemPct: 112.6 });
    expect(g.company.policies.perDiemPct).toBe(113);
  });
});
