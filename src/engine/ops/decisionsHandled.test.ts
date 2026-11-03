// v0.15 a crew card the player has already dealt with another way is withdrawn (it no longer holds the clock).

import { describe, expect, it } from 'vitest';
import { pushDecision } from '../core/messages';
import type { GameState } from '../core/types';
import { autoRoster, flightCrewStatus } from '../crew';
import { fixtureGame } from '../crew/fixtures';
import { devCrewShortage, demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { withdrawHandled } from './events';

function game(): GameState {
  const g = fixtureGame(9);
  demoFlights(g, undefined, 3, 'revenue');
  autoRoster(g);
  advanceTo(g, g.now + 6 * 60);
  return g;
}

const card = (g: GameState, kind: 'sickCrew' | 'crewShort', flightId: string) =>
  pushDecision(g, { kind, title: kind, body: 'x', defaultOption: 'a', expires: g.now + 600, options: [{ id: 'a', label: 'A', desc: '' }], data: { flightId, paced: true } });

describe('v0.15 withdrawHandled', () => {
  it('a sick call: kept while its flight has nobody, withdrawn once it is crewed or gone; other cards untouched', () => {
    const g = game();
    const short = devCrewShortage(g, { hours: 24 });
    expect(short).toBeTruthy();
    const crewed = Object.values(g.flights).find((f) => f.status === 'scheduled' && f.id !== short && ['ok', 'tight'].includes(flightCrewStatus(g, f.id).level))!;
    expect(crewed).toBeTruthy();
    const a = card(g, 'sickCrew', short);
    const b = card(g, 'sickCrew', crewed.id);
    const other = pushDecision(g, { kind: 'dev', title: 'x', body: 'x', defaultOption: 'a', expires: g.now + 600, options: [{ id: 'a', label: 'A', desc: '' }], data: { paced: true } });
    expect(withdrawHandled(g)).toEqual([b.id]);
    expect(g.decisions.map((d) => d.id)).toEqual([a.id, other.id]);
    g.flights[short].status = 'cancelled';
    expect(withdrawHandled(g)).toEqual([a.id]);
    expect(g.decisions.map((d) => d.id)).toEqual([other.id]);
  });

  it("the gate's crew-short card: kept while the leg cannot go, withdrawn once it is cancelled or sub-chartered", () => {
    const g = game();
    const short = devCrewShortage(g, { hours: 24 });
    const d = card(g, 'crewShort', short);
    expect(withdrawHandled(g)).toEqual([]);
    g.flights[short].status = 'cancelled';
    expect(withdrawHandled(g)).toEqual([d.id]);
  });
});
