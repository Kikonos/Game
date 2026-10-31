// v0.12.1 (Round F, C14 / UI-12(a)): "leaves in 1 days".
import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { fixtureGame } from '../crew/fixtures';
import { crewResignedCard } from './crew';

describe('the resignation card counts days in plain words', () => {
  it("says '1 day', '3 days'", () => {
    const g = fixtureGame(5);
    const c = Object.values(g.crew)[0];
    c.notice = { given: g.now - 20 * DAY, leaves: g.now + DAY };
    expect(crewResignedCard(g, c.id)!.title).toMatch(/leaves in 1 day$/);
    c.notice = { given: g.now - 20 * DAY, leaves: g.now + 3 * DAY };
    expect(crewResignedCard(g, c.id)!.title).toMatch(/leaves in 3 days$/);
  });
});
