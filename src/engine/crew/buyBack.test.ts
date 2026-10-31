// v0.12.1 round D: the day-off buy-back (the player's ask) and the BLU1570 Goma chain: the two pilots sitting at the
// departure, held back only by days off, keep the flight (bought back, paid, the day repaid) instead of being sent
// home while the card blames 'your free captains are in Lisbon'; never the rest rules; once a month; the setting.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { takeCueEvents } from '../core/cues';
import { DAY } from '../core/time';
import type { BuyBackMode, GameState } from '../core/types';
import { planCrew } from './check';
import { buyBackFor, buyBackPay } from './buyBack';
import { applyCrewFix, crewControl } from './control';
import { dayIndex } from './dayPlan';
import { buildDuties } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { autoRoster, placeCrew, releaseCrew } from './roster';
import { advanceTo } from '../sim';
import { segsOf, touchCrew } from './timeline';

const H = 60;

/** An A320 at Goma, an empty leg GOM–NDJ tonight; a captain and a first officer sit in Goma on a day off today. */
function goma(mode: BuyBackMode = 'auto'): { g: GameState; dutyId: string; flightId: string; here: string[] } {
  const g = fixtureGame();
  g.company.policies.buyBack = mode;
  const ac = Object.values(g.fleet)[0];
  ac.at = 'GOM';
  const std = Math.floor(g.now / DAY) * DAY + 20 * H;
  const f = addFlight(g, { no: 'AW1570', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'GOM', to: 'NDJ', std, sta: std + 195 });
  const here = addCrew(g, { CPT: 1, FO: 1 });
  for (const id of here) {
    const c = g.crew[id];
    c.loc = 'GOM';
    c.awaySince = g.now - DAY;
    c.morale = 70;
    const k = dayIndex(c.base, std);
    c.off = [...new Set([...(c.off ?? []), k])].sort((a, b) => a - b);
  }
  touchCrew(g);
  const d = buildDuties(g, ac.id, g.now, g.now + 3 * DAY)[0];
  return { g, dutyId: d.id, flightId: f.id, here };
}

const crewOn = (g: GameState, dutyId: string) => g.pairings[g.duties[dutyId].pairingId].slots.map((s) => s.crewId);

describe('v0.12.1 day-off buy-back', () => {
  it('BLU1570: the roster keeps the pilots already at the departure, buys their day off and says so with a chime', () => {
    const { g, dutyId, here } = goma('auto');
    const sal0 = g.finance.current.lines.salaries ?? 0;
    takeCueEvents();
    autoRoster(g, {});
    expect(crewOn(g, dutyId).sort()).toEqual([...here].sort());
    for (const id of here) {
      const c = g.crew[id];
      expect(c.boughtOff?.length).toBe(1);
      // The day off is gone from the day worked and given back on another day of the month.
      expect(c.off).not.toContain(dayIndex(c.base, g.flights[g.duties[dutyId].flightIds[0]].std));
    }
    const paid = here.reduce((n, id) => n + buyBackPay(g.crew[id]), 0);
    // v0.12.1 (Round F, C8) the pay waits on the seats until the pilots report.
    expect(sal0 - (g.finance.current.lines.salaries ?? 0)).toBe(0);
    const slots = g.pairings[g.duties[dutyId].pairingId].slots.filter((s) => s.crewId && here.includes(s.crewId));
    expect(slots.reduce((n, s) => n + (s.buyBack?.cost ?? 0), 0)).toBeGreaterThanOrEqual(paid);
    const msgs = g.messages.filter((m) => /works the day off on .* for AW1570 \(\+\$/.test(m.title));
    expect(msgs.length).toBe(2);
    expect(msgs[0].body).toMatch(/twice a day's pay/);
    // Every chime has its note: one per message.
    const cues = takeCueEvents().filter((e) => /works the day off/.test(e.title));
    expect(cues.length).toBe(2);
    // No ticket was bought to fly anyone else in (only the ticket home from N'Djamena).
    expect(g.duties[dutyId].deadheadIds.map((id) => g.flights[id]).filter((t) => t.to === 'GOM')).toEqual([]);
  });

  it('v0.12.1 (C8) paid once when they report; undone, unpaid, with the day off back, when they come off first', () => {
    const { g, dutyId, here } = goma('auto');
    autoRoster(g, {});
    const d = g.duties[dutyId];
    const p = g.pairings[d.pairingId];
    const [a, b] = here.map((id) => g.crew[id]);
    const dayA = dayIndex(a.base, g.flights[d.flightIds[0]].std);
    const owed = p.slots.find((s) => s.crewId === b.id)!.buyBack!.cost;
    // One comes off before the report (a swap, a re-plan): the day off comes back and nothing is paid for it.
    const sal0 = g.finance.current.lines.salaries ?? 0;
    releaseCrew(g, p, a.id);
    expect(a.off).toContain(dayA);
    expect(a.boughtOff ?? []).toEqual([]);
    expect(p.slots.some((s) => s.buyBack && s.crewId === null)).toBe(false);
    expect(g.finance.current.lines.salaries ?? 0).toBe(sal0);
    expect(g.messages[0].title).toMatch(/keeps the day off/);
    // The other reports: paid then, once.
    advanceTo(g, d.report + 1, new Set());
    const sal1 = g.finance.current.lines.salaries ?? 0;
    expect(sal0 - sal1).toBeGreaterThanOrEqual(owed);
    expect(p.slots.find((s) => s.crewId === b.id)?.buyBack).toBeUndefined();
    advanceTo(g, d.report + 120, new Set());
    expect(g.finance.current.lines.salaries ?? 0).toBe(sal1);
  });

  it('Never: no day off is bought; Ask me: Crew Control offers "Ask … to work a day off" with its cost', () => {
    for (const mode of ['never', 'ask'] as const) {
      const { g, dutyId, flightId, here } = goma(mode);
      autoRoster(g, {});
      for (const id of here) expect(g.crew[id].boughtOff, mode).toBeUndefined();
      expect(crewOn(g, dutyId).some((id) => id && here.includes(id)), mode).toBe(false);
      if (mode === 'ask') {
        // Empty the seats again (the roster may have flown others in) to see the offer.
        const p = g.pairings[g.duties[dutyId].pairingId];
        for (const s of p.slots) s.crewId = null;
        touchCrew(g);
        const v = crewControl(g, flightId)!;
        const s = v.solutions.find((x) => x.id === 'buyBack')!;
        expect(s.available, s.why).toBe(true);
        expect(s.label).toMatch(/^Ask 2 crew to work a day off|^Ask .+ to work a day off$/);
        expect(s.cost).toBeGreaterThan(0);
        const r = applyCrewFix(g, flightId, 'buyBack', { confirmed: true });
        expect(r.ok, r.ok ? '' : r.error).toBe(true);
        expect(crewOn(g, dutyId).filter((id) => id && here.includes(id)).length).toBe(2);
        expect(g.messages[0].body).toMatch(/works the day off/);
      }
    }
  });

  it('never breaks the 168 h recovery (ORO.FTL.235(d)) and is at most once a month a person', () => {
    const { g, dutyId, here } = goma('auto');
    const d = g.duties[dutyId];
    const p = g.pairings[d.pairingId];
    const c = g.crew[here[0]];
    const ok = buyBackFor(g, c, planCrew(g, c, p, segsOf(g, c, p.id)), segsOf(g, c, p.id));
    expect(ok).not.toBeNull();
    // Due a weekly rest (ORO.FTL.235(d): no 36 h recovery in 168 h): never bought, whatever the days off.
    const base = planCrew(g, c, p, segsOf(g, c, p.id));
    const due = { ...base, issues: [...base.issues, { code: 'recovery' as const, level: 'illegal' as const, text: 'No 36 h recovery in 168 h', dutyId }], level: 'illegal' as const };
    expect(buyBackFor(g, c, due, segsOf(g, c, p.id))).toBeNull();
    // Nor the rest before it: still resting at the report.
    c.restUntil = d.report + H;
    touchCrew(g);
    const tired = planCrew(g, c, p, segsOf(g, c, p.id));
    expect(tired.issues.some((i) => i.code !== 'daysOff' && i.level === 'illegal')).toBe(true);
    expect(buyBackFor(g, c, tired, segsOf(g, c, p.id))).toBeNull();
    // Once a month.
    c.restUntil = 0;
    c.boughtOff = [ok!.month];
    touchCrew(g);
    expect(buyBackFor(g, c, planCrew(g, c, p, segsOf(g, c, p.id)), segsOf(g, c, p.id))).toBeNull();
    // Old saves: the setting reads automatically.
    delete g.company.policies.buyBack;
    autoRoster(g, {});
    expect(crewOn(g, dutyId)).toContain(here[1]);
  });

  it('no preview or placement shows a ticket already gone: a crew member who can no longer reach it gets a ticket that can still be flown', () => {
    const { g, dutyId } = goma('never');
    const p = g.pairings[g.duties[dutyId].pairingId];
    // Three hours before departure a Lisbon first officer is placed by hand: the plan cannot reach Goma in time.
    g.now = g.flights[g.duties[dutyId].flightIds[0]].std - 3 * H;
    const fo = Object.values(g.crew).find((c) => c.role === 'FO' && c.loc === 'LIS')!;
    placeCrew(g, p, p.slots.findIndex((s) => s.role === 'FO'), fo);
    for (const id of g.duties[dutyId].deadheadIds) expect(g.flights[id].std).toBeGreaterThanOrEqual(g.now);
    const v = crewControl(g, g.duties[dutyId].flightIds[0])!;
    for (const s of v.solutions) for (const line of s.preview.changes) expect(line, s.id).not.toMatch(/lands \d+ \w{3} \d\d:\d\d\)/);
  });
});
