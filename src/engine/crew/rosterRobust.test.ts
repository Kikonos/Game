// Roster robustness (engine lane, v0.5): tours that grow keep their crew's tickets in step, the planning
// margin on extended recovery, and staffing that counts deployments.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Seg, TimelineCtx } from './rules';
import { evalSegs } from './rules';
import { fixtureGame, seasonBase } from './fixtures';
import { autoRoster, staffing } from '.';

const duty = (start: number, end: number): Seg => ({
  kind: 'duty', start, end, fdp: end - start, maxFdp: 13 * 60, block: end - start - 60, sectors: 2, aug: false, disruptive: false, rest: 12 * 60, at: 'LIS', fresh: true,
});

describe('roster robustness', () => {
  it('re-plans the ticket home when a crewed tour grows past its last duty', () => {
    const g = fixtureGame();
    g.company.policies.rotationWeeks = 5;
    const acId = Object.keys(g.fleet)[0];
    const k = seasonBase(g, acId, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30], 12);
    autoRoster(g, { to: g.now + 30 * DAY });
    // The client extends the programme by a week (as the daily schedule extension does).
    const ac = g.fleet[acId];
    const out = blockMinutes(ac.typeId, 'HAM', 'PMI');
    const turn = typeOf(ac.typeId).turnMin;
    const last = Object.values(g.flights).filter((f) => f.contractId === k.id).sort((a, b) => b.std - a.std)[0];
    for (let d = 1; d <= 7; d++) {
      const std = last.std - 12 * 60 - 30 + d * DAY;
      addFlight(g, { no: `NX${d}a`, aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'HAM', to: 'PMI', std, sta: std + out });
      addFlight(g, { no: `NX${d}b`, aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'PMI', to: 'HAM', std: std + out + turn, sta: std + 2 * out + turn });
    }
    k.end += 7 * DAY;
    if (k.pattern.kind === 'base') k.pattern.to += 7 * DAY;
    autoRoster(g, { to: g.now + 30 * DAY });
    const tours = Object.values(g.pairings).filter((p) => p.tour && p.slots.some((s) => s.crewId));
    // Tours of sets 1 and 2 take the new week's duties.
    expect(tours.filter((p) => p.end > last.sta + DAY).length).toBeGreaterThan(1);
    for (const p of tours) {
      for (const s of p.slots) {
        if (!s.crewId) continue;
        // No crew member of a tour flies home before the tour's last duty.
        const home = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(s.crewId!) && f.to === 'LIS');
        for (const f of home) if (f.std >= p.start && f.std < p.end) expect.fail(`${s.crewId} flies home ${f.std} inside tour ${p.id} (${p.start}–${p.end})`);
      }
    }
  });

  it('plans extended recovery with a margin, re-checks work in place without it', () => {
    const ctx: TimelineCtx = { base: 'LIS', restUntil: 0, lastRecovery: 0, blockYear: 0, blockYearOf: 2027 };
    // Six days of 10:00–18:00 UTC duty, a 36 h 30 min break holding two local nights, then the next duty:
    // a delay of the planning margin (60 min) on the last day would leave 35 h 30 min.
    const t0 = Date.UTC(2027, 5, 1, 10) / 60000 - Date.UTC(2000, 0, 1) / 60000;
    const segs: Seg[] = [];
    for (let d = 0; d < 6; d++) segs.push(duty(t0 + d * DAY, t0 + d * DAY + 8 * 60));
    const lastEnd = segs[5].end;
    segs.push(duty(lastEnd + 36 * 60 + 30, lastEnd + 36 * 60 + 30 + 8 * 60));
    const rec = (slack: number) => evalSegs({ ...ctx, lastRecovery: t0 - 60, slack }, segs).filter((i) => i.code === 'recovery');
    expect(rec(0)).toEqual([]);
    expect(rec(60).length).toBeGreaterThan(0);
  });

  it('counts a deployment\'s sets on station in the staffing need', () => {
    const g = fixtureGame();
    const before = staffing(g).find((l) => l.role === 'CPT')!.need;
    const acId = Object.keys(g.fleet)[0];
    seasonBase(g, acId, 'HAM', 'PMI', [6 * 60, 12 * 60 + 30, 19 * 60], 21);
    autoRoster(g, { to: g.now + 30 * DAY });
    const dep = Object.values(g.deployments)[0];
    expect(dep.setsOnStation).toBeGreaterThanOrEqual(4);
    const need = staffing(g).find((l) => l.role === 'CPT')!.need;
    expect(need).toBe(before - 5 + dep.setsOnStation + 2);
  });
});
