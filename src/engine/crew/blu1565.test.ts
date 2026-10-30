// v0.12.1 round D, BLU1565 FRA–FNC (player's 24 Oct screenshot): four days out the card read "Your free captains are in
// Lisbon: flown in the same day their day would be too long, and after a night's rest they report too late", beside a
// timeline whose earliest landing had 83 h to spare. The real blocker was days off: a 'daysOff' issue had no reason code
// of its own and fell back to 'place', and the place story then guessed. Now the card names the day off.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import { crewShortCard } from './control';
import { dayIndex } from './dayPlan';
import { buildDuties } from './duties';
import { fixtureGame } from './fixtures';
import { rootReason } from './reasons';
import { autoRoster } from './roster';
import { touchCrew } from './timeline';
import { dutyCandidates } from './rosterActions';
import { tickTimes, legText } from '../../ui/components/problemLogic';

const H = 60;

function fra() {
  const g = fixtureGame();
  const ac = Object.values(g.fleet)[0];
  ac.at = 'FRA';
  // Four days out (past the 72 h a buy-back looks ahead), just after midnight.
  const std = Math.floor(g.now / DAY) * DAY + 4 * DAY + 25;
  const f = addFlight(g, { no: 'AW1565', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'FRA', to: 'FNC', std, sta: std + 240 });
  // Every captain is on days off over the report.
  for (const c of Object.values(g.crew)) {
    if (c.role !== 'CPT') continue;
    const k = dayIndex(c.base, std);
    c.off = [...new Set([...(c.off ?? []), k - 1, k])].sort((a, b) => a - b);
  }
  touchCrew(g);
  const d = buildDuties(g, ac.id, g.now, g.now + 6 * DAY)[0];
  autoRoster(g, {});
  return { g, f, d };
}

describe('BLU1565: the captains are on days off, not out of reach', () => {
  it('the reason is the day off, in words ("on a day off …"), never the place fallback', () => {
    const { g, d } = fra();
    const cands = dutyCandidates(g, d.id, 'CPT').filter((c) => !c.onPairing && c.loc === 'LIS');
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) if (c.codes.length === 1 && c.codes[0] === 'daysOff') expect(c.reason?.code, c.reasons.join()).toBe('daysOff');
    const off = cands.find((c) => c.reason?.code === 'daysOff')!;
    expect(off.reason!.text).toMatch(/^on a day off \w{3} \d+ \w{3}|^short of days off in/);
    expect(rootReason(g, [{ code: 'daysOff', level: 'illegal', text: 'Days off in October would fall to 6 (minimum 7)' }], g.crew[off.crewId])?.text).toBe('short of days off in October (6 of 7 with this trip)');
  });

  it("the card says so, and never 'flown in the same day … after a night's rest they report too late' with days to spare", () => {
    const { g, f } = fra();
    const card = crewShortCard(g, f.id)!;
    expect(card).not.toBeNull();
    expect(card.why).toMatch(/day off|days off/);
    expect(card.why).not.toMatch(/flown in the same day|report too late/);
  });

  it('timeline labels carry the date whenever it is not the day of Now', () => {
    const now = Math.floor(14_600_000 / DAY) * DAY + 60;
    expect(tickTimes(now + 7 * H, 'FNC', now)[0]).toBe(`${tickTimes(now + 7 * H, 'FNC')[0]}`);
    expect(tickTimes(now + 3 * DAY + 19 * H, 'FNC', now)[0]).toMatch(/^\d+ \w{3} \d\d:\d\d UTC$/);
    expect(tickTimes(now + 3 * DAY + 19 * H, 'FNC', now)[1]).toMatch(/^\d+ \w{3} \d\d:\d\d FNC$/);
    expect(legText({ no: 'FR 1474', airline: 'Ryanair', from: 'LIS', to: 'SOF', dep: now + DAY + H, arr: now + DAY + 5 * H }, now)).toMatch(/LIS–SOF \d+ \w{3} \d\d:\d\d→\d+ \w{3} \d\d:\d\d$/);
  });
});
