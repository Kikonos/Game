// v0.25 (comm-visit-spam) a client visited again and again: little relation, few leads, one live lead per kind of
// work, one tender per round, and meetings on working days.

import { describe, expect, it } from 'vitest';
import { DAY, localOffset, toDate } from '../core/time';
import type { Client, GameState } from '../core/types';
import { newGame, run } from '../contracts/testkit';
import { resolveDecision } from '../ops';
import { com } from './state';
import { bookTrip, tripQuote, workDay } from './trips';
import './index';

const LIVE = new Set(['lead', 'proposal', 'negotiation']);

function spam(g: GameState, cl: Client, days: number): number {
  let n = 0;
  const end = g.now + days * DAY;
  while (g.now < end && !g.gameOver) {
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    if (tripQuote(g, 'ceo', { clientId: cl.id }).ok && bookTrip(g, 'ceo', { clientId: cl.id }).ok) n++;
    run(g, g.now + 360);
    // No two live leads for the same client and kind of work, at any time.
    const live = (g.com?.leads ?? []).filter((l) => l.clientId === cl.id && LIVE.has(l.stage));
    expect(new Set(live.map((l) => l.archetype)).size).toBe(live.length);
  }
  return n;
}

describe('v0.25 repeated client visits', () => {
  it('back-to-back visits: the first counts, the rest add little; one tender per round', () => {
    const g = newGame(26);
    const cl = Object.values(g.clients).find((c) => c.name === 'Condor')!;
    cl.met = g.now;
    const rel0 = cl.relation;
    const n = spam(g, cl, 40);
    expect(n).toBeGreaterThanOrEqual(4);
    // Before: 8 a visit (n × 8); now 8 for the first and at most 2 for each one after, plus whatever the leads brought.
    const visits = (cl.log ?? []).filter((x) => /visited them/.test(x[2])).map((x) => x[1]);
    expect(visits[0]).toBe(8);
    for (const v of visits.slice(1)) expect(v).toBeLessThanOrEqual(2);
    expect(cl.relation - rel0).toBeLessThan(8 * n);
    expect(cl.lastVisit).toBeDefined();
    const rounds = com(g).tenders.filter((t) => t.clientId === cl.id).map((t) => t.round);
    expect(new Set(rounds).size).toBe(rounds.length);
  });

  it('meetings fall on a working day there (Mon–Fri; Sun–Thu in the Gulf)', () => {
    const g = newGame(31);
    const cls = Object.values(g.clients).filter((c) => !c.ceased && ['DE', 'SA', 'AE', 'GB', 'PT'].includes(c.country)).slice(0, 8);
    expect(cls.length).toBeGreaterThan(0);
    for (let d = 0; d < 7; d++) {
      for (const c of cls) {
        c.met = g.now;
        const q = tripQuote(g, 'ceo', { clientId: c.id });
        if (!q.ok) continue;
        const local = toDate(q.start + localOffset(c.base, q.start));
        expect(workDay(c.country, local.getUTCDay()), `${c.name} ${c.country} ${local.toISOString()}`).toBe(true);
      }
      g.now += DAY;
    }
    expect(workDay('SA', 5)).toBe(false);
    expect(workDay('SA', 0)).toBe(true);
    expect(workDay('DE', 6)).toBe(false);
  });
});
