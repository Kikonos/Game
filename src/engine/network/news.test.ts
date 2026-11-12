// v0.23.1 network news (report bmwdo5trhi3sl): a market study done and a route going on sale each raise their own cue
// (the UI's pop-up) and the 'network' pause (Settings › Pause for network news).

import { describe, expect, it } from 'vitest';
import { takeCueEvents } from '../core/cues';
import type { PauseReason } from '../core/pause';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { caseDraft, decideCase, startStudy } from '.';
import type { GameState } from '../core/types';

const newGame = (seed = 11) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

/** Plays on day by day, honouring only the network pause; the pauses met and the network cues raised. */
function play(g: GameState, days: number) {
  const pauses: PauseReason[] = [];
  const cues: { cue: string; title: string; ref?: { kind: string; id: string } }[] = [];
  const end = g.now + days * DAY;
  const honour = new Set<PauseReason>(['network']);
  while (g.now < end) {
    const r = advanceTo(g, Math.min(end, g.now + DAY), honour);
    if (r.pause) pauses.push(r.pause);
    for (const e of takeCueEvents()) if (e.cue === 'routeStudy' || e.cue === 'routeLaunched') cues.push({ cue: e.cue, title: e.title, ref: e.ref });
  }
  return { pauses, cues };
}

describe('v0.23.1 network news pops up and pauses', () => {
  it('the study done: its cue (with the route) and the network pause; going on sale: the same', () => {
    const g = newGame();
    const res = startStudy(g, 'LIS-OXB', 'desk');
    const id = res.routeId!;
    takeCueEvents();
    const a = play(g, 20);
    expect(g.network!.routes[id].status).toBe('case');
    expect(a.pauses).toContain('network');
    expect(a.cues).toEqual([{ cue: 'routeStudy', title: 'Study done: Bissau', ref: { kind: 'route', id } }]);
    expect(decideCase(g, id, 'go', caseDraft(g, id)!)).toBeNull();
    const b = play(g, 220);
    expect(['onSale', 'operating']).toContain(g.network!.routes[id].status);
    expect(b.pauses).toContain('network');
    expect(b.cues.filter((c) => c.cue === 'routeLaunched')).toEqual([{ cue: 'routeLaunched', title: 'Bissau: tickets on sale', ref: { kind: 'route', id } }]);
  });
});
