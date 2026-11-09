import { describe, expect, it } from 'vitest';
import { deserialize } from '../save';
import { quoteTripMove } from './tripMove';
import { fixture } from '../fixtures/compatKit';

// v0.19.1 the player: an A320 all-economy job, the A320 AOG, only an A340 two-class free — "only seat numbers should
// matter". The client's cabin, size, family and body preferences give way in an emergency swap; seats still count.
const PREF = /client asked for|only takes|wants a narrowbody|wants a widebody|at most|livery/;

describe('emergency swap (source aircraft AOG)', () => {
  it('waives cabin/family/body preferences when the source is AOG, keeps them otherwise', () => {
    const g: any = deserialize(fixture('v0182-cp7040'));
    const wide = Object.values<any>(g.fleet).filter((a) => /a33|a34|b77|b76/.test(a.typeId) && !['stored', 'leasedOut', 'delivering'].includes(a.status));
    let checked = 0;
    for (const f of Object.values<any>(g.flights)) {
      if (checked >= 3) break;
      if (f.status !== 'scheduled' || f.kind !== 'revenue' || f.std < g.now + 2 * 1440 || !f.aircraftId) continue;
      const ac = g.fleet[f.aircraftId];
      if (!/a32/.test(ac.typeId)) continue;
      for (const w of wide) {
        const before = quoteTripMove(g, f.id, w.id, { quick: true });
        if (!before.reasons.some((r: string) => PREF.test(r))) continue;
        g.maintenance.mxtest = { id: 'mxtest', aircraftId: ac.id, kind: 'AOG', at: f.from, start: g.now, end: f.std + 3 * 1440, cost: 0, status: 'inWork', planned: false, ev: 0 };
        const after = quoteTripMove(g, f.id, w.id);
        delete g.maintenance.mxtest;
        expect(after.reasons.some((r: string) => PREF.test(r))).toBe(false);
        if (after.ok) expect(after.warnings.some((x: string) => /Emergency swap/.test(x))).toBe(true);
        checked++;
        break;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});
