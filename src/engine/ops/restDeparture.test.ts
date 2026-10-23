// v0.9 §Y.1 (UPDATE-0.9.md): a delay after the crew has reported can make an augmented duty's in-flight rest plan
// impossible; the departure re-checks it: the flight is held, the cabin crew read out of hours, never flown illegally.

import { describe, expect, it } from 'vitest';
import { takeCues } from '../core/cues';
import { clearPause } from '../core/pause';
import { devRestPlan } from '../dev';
import { advanceTo, settle } from '../sim';
import { crewAlertKind, restPlan } from '../crew';
import { fixtureGame } from '../crew/fixtures';
import { delayFlight } from './flights';

describe('§Y.1 in-flight rest re-checked at departure', () => {
  it('a long delay after report breaks the rest plan: held at the gate, crew out of hours, never departs with it', () => {
    const g = fixtureGame(41);
    const fid = devRestPlan(g);
    const f = g.flights[fid];
    const d0 = g.duties[f.dutyId!];
    expect(d0.augment).toBeGreaterThan(0);
    // Report, then the gate hold grows until the cabin crew can no longer all rest in this cruise.
    advanceTo(g, d0.report + 5, new Set());
    const d = g.duties[f.dutyId!];
    expect(restPlan(g, d.id)?.ok).toBe(true);
    let broke = false;
    for (let h = 0; h < 8 && !broke; h++) {
      delayFlight(g, fid, 60, 'Technical: APU');
      settle(g);
      broke = restPlan(g, g.flights[fid].dutyId ? g.flights[fid].dutyId! : d.id)?.ok === false;
    }
    expect(broke).toBe(true);
    clearPause();
    takeCues();
    const ill0 = g.stats.illegalFlown ?? 0;
    advanceTo(g, g.flights[fid].std + 30, new Set());
    const ff = g.flights[fid];
    if (ff.status !== 'scheduled') {
      // It left only once a legal plan was found (a fresh crew or re-planned turns).
      const dd = ff.dutyId ? g.duties[ff.dutyId] : undefined;
      expect(dd && restPlan(g, dd.id)?.ok !== false).toBe(true);
    } else {
      expect(crewAlertKind(g, fid)).toBe('hours');
      expect(g.messages.some((m) => m.topic === 'crewHours' && m.title.startsWith(`CREW OUT OF HOURS: ${ff.no}`))).toBe(true);
    }
    expect(g.stats.illegalFlown ?? 0).toBe(ill0);
  });
});
