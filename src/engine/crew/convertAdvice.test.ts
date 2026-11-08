// v0.18.3 Convert surplus crew (Crew › Utilisation › Convert): targets short of crew first (a 757 arriving), the
// least busy go, classes kept to the training centre's size, trips in the way handed to a legal replacement in a
// dry run, and booking applies both.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { devAddType } from '../dev';
import { addCrew, fixtureGame } from './fixtures';
import { applyConvertOption, autoRoster, buildDuties, classOf, CONVERT, convertAdvice, convertOptions, convertTargets, conversionEarliest, rosterOf } from '.';

const rich = (): GameState => {
  const g = fixtureGame();
  g.company.cash = 50_000_000;
  return g;
};

describe('v0.18.3 Convert: which type', () => {
  it('a 757 on its way and short of captains comes first, with why; the A330 we fly but is not short after it', () => {
    const g = rich();
    addCrew(g, { CPT: 12 }, 'A320');
    const id = devAddType(g, 'b752');
    const ac = g.fleet[id];
    ac.status = 'delivering';
    ac.deliveredAt = g.now + 40 * DAY;
    const ts = convertTargets(g, 'A320', 'CPT');
    expect(ts[0].family).toBe('B757/767');
    expect(ts[0].short).toBeGreaterThan(0);
    expect(ts[0].kind).toBe('arriving');
    expect(ts[0].why).toMatch(/captains? short/);
    expect(ts[0].why).toContain(ac.reg);
    expect(ts[0].ccq).toBe(false);
  });
  it('with nothing short: the types we fly or have coming that they lack (held), never their own type', () => {
    const g = rich();
    addCrew(g, { CPT: 12 }, 'A320');
    devAddType(g, 'a333');
    const ts = convertTargets(g, 'A320', 'CPT');
    expect(ts.map((t) => t.family)).not.toContain('A320');
    expect(ts.every((t) => t.family === 'A330/340')).toBe(true);
    expect(ts[0].ccq).toBe(true);
  });
});

describe('v0.18.3 Convert: who and when', () => {
  it('pilots in classes of at most 8, the least busy first, deterministic', () => {
    const g = rich();
    addCrew(g, { CPT: 20 }, 'A320');
    devAddType(g, 'a333');
    const a = convertAdvice(g, 'A320', 'CPT', 11);
    expect(a.options.length).toBeGreaterThan(0);
    for (const o of a.options) {
      for (const k of o.classes) expect(k.crewIds.length).toBeLessThanOrEqual(CONVERT.pilotClass);
      expect(o.classes.flatMap((k) => k.crewIds).length).toBe(a.want);
      expect(o.ready).toBe(Math.max(...o.classes.map((k) => k.end)));
      expect(o.fees).toBeGreaterThan(0);
    }
    expect(JSON.stringify(convertAdvice(g, 'A320', 'CPT', 11))).toBe(JSON.stringify(a));
  });
  it('a trip in the way of the course goes to a legal replacement in the dry run; booking applies it and books the class', () => {
    const g = rich();
    const ac = Object.values(g.fleet)[0];
    const crew = addCrew(g, { CPT: 6, FO: 6, PUR: 6, CC: 24 }, 'A320');
    for (const id of crew) g.crew[id].off = [];
    devAddType(g, 'a333');
    const e = conversionEarliest(g);
    const std = e + 3 * DAY + 9 * 60;
    addFlight(g, { no: 'AW77', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FAO', std, sta: std + 60 });
    addFlight(g, { no: 'AW78', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FAO', to: 'LIS', std: std + 120, sta: std + 180 });
    buildDuties(g, ac.id, g.now, g.now + 10 * DAY);
    autoRoster(g, { aircraftIds: [ac.id] });
    const cpt = Object.values(g.crew).find((c) => c.role === 'CPT' && rosterOf(g, c.id, e, e + 10 * DAY).some((d) => !d.done));
    expect(cpt).toBeTruthy();
    // Needed right away: the one start day open is the one with the trip.
    const opts = convertOptions(g, [cpt!.id], 1, 'A330/340', e + 10 * DAY);
    const o = opts.find((x) => x.swaps.length > 0);
    expect(o, JSON.stringify(opts.map((x) => [x.title, x.swaps.length, x.unresolved]))).toBeTruthy();
    expect(o!.swaps[0].text).toMatch(new RegExp(`^${cpt!.last}'s AW77 on .+ goes to `));
    const to = o!.swaps[0].to;
    const r = applyConvertOption(g, 'A330/340', o!);
    expect(r.ok).toBe(true);
    expect(classOf(g, cpt!.id)).toBeTruthy();
    const p = g.pairings[o!.swaps[0].pairingId];
    expect(p.slots.some((s) => s.crewId === to)).toBe(true);
    expect(p.slots.some((s) => s.crewId === cpt!.id)).toBe(false);
    expect(g.messages.some((m) => /re-crewed for the A330 course/.test(m.title))).toBe(true);
  });
});
