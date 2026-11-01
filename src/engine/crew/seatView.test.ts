// v0.14.1 the Duty dialog's seats (UI-2, UI-13): a seat on a duty over its day-length limit never reads 'Legal' above
// its red 'Day length 17:40 of 12:15' gauge; the rest gauge shows the real rest past the minimum ('21:30 · min 10:00'),
// not '10:00 of 10:00' for a crew member who rested 21 h.

import { describe, expect, it } from 'vitest';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { crewGauges } from './control';
import { fixtureGame } from './fixtures';
import { dutyCrew } from './rosterActions';

function game() {
  const g = fixtureGame(5);
  demoFlights(g, undefined, 8, 'revenue');
  advanceTo(g, g.now + 2 * 24 * 60);
  return g;
}

describe('v0.14.1 Duty dialog seats', () => {
  it('a duty over its FDP limit: every crewed seat reads Illegal, not Legal', () => {
    const g = game();
    const d = Object.values(g.duties).find((x) => !x.done && x.report > g.now && dutyCrew(g, x.id)!.slots.some((s) => s.crewId))!;
    expect(dutyCrew(g, d.id)!.slots.filter((s) => s.crewId).every((s) => s.level !== 'illegal')).toBe(true);
    d.fdp = d.maxFdp + 60;
    d.legality = 'illegal';
    const seats = dutyCrew(g, d.id)!.slots.filter((s) => s.crewId);
    expect(seats.length).toBeGreaterThan(0);
    for (const s of seats) expect(s.level).toBe('illegal');
  });

  it('the rest gauge past its minimum shows the rest taken and the minimum, the bar full', () => {
    const g = game();
    let seen = 0;
    for (const d of Object.values(g.duties)) {
      if (d.done || d.report <= g.now) continue;
      const p = g.pairings[d.pairingId];
      for (const s of p.slots) {
        if (!s.crewId) continue;
        const rest = crewGauges(g, s.crewId, d.id).find((x) => x.id === 'rest');
        if (!rest || rest.tone !== 'good') continue;
        seen++;
        expect(rest.value).toBe(rest.limit);
        expect(rest.text).toMatch(/^\d+:\d\d · min \d+:\d\d$/);
        expect(rest.text).not.toMatch(/ of /);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('v0.14.1 the duty sheet release', () => {
  it('is dated when it falls on another UTC day than the report', async () => {
    const { releaseText } = await import('./rosterActions');
    const day = 20 * 1440;
    expect(releaseText(day + 7 * 60, day + 19 * 60 + 45)).toBe('19:45');
    expect(releaseText(day + 23 * 60, day + 1440 + 6 * 60 + 50)).toMatch(/^\w{3} \d+ \w{3} 06:50$|^\d+ \w{3} 06:50$/);
  });
});
