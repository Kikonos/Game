// v0.24 clients met in this save (the player: "Visit clients should show the clients I have interacted with").

import { describe, expect, it } from 'vitest';
import { bookTrip, tripQuote, visitableClients } from '../commercial';
import { DAY } from '../core/time';
import { declineOffer } from './index';
import { bumpClient, loadRelations, metClientIds } from './relations';
import { dailyOffers } from './offers';
import { newGame, offer } from './testkit';

describe('v0.24 clients met', () => {
  it('a new game has met only the clients whose offers are on the desk', () => {
    const g = newGame();
    const met = metClientIds(g);
    const withOffers = new Set(Object.values(g.offers).map((o) => o.clientId));
    expect([...met].sort()).toEqual([...withOffers].sort());
    expect(met.size).toBeLessThan(Object.keys(g.clients).length / 4);
  });

  it('an offer received is remembered after it is gone; a relation change with a reason counts, the drift does not', () => {
    const g = newGame();
    const o = offer(g, 'adhoc', { start: g.now + 10 * DAY });
    expect(g.clients[o.clientId].met).toBeUndefined();
    declineOffer(g, o.id);
    expect(g.clients[o.clientId].met).toBe(g.now);
    delete g.offers[o.id];
    expect(metClientIds(g).has(o.clientId)).toBe(true);
    const other = Object.values(g.clients).find((c) => c.met === undefined && !metClientIds(g).has(c.id))!;
    bumpClient(g, other.id, 3, '');
    expect(other.met).toBeUndefined();
    bumpClient(g, other.id, 3, 'Met at a fair');
    expect(other.met).toBe(g.now);
  });

  it('the daily offer sweep marks the open offers too', () => {
    const g = newGame();
    const o = offer(g, 'adhoc', { start: g.now + 10 * DAY });
    dailyOffers(g);
    expect(g.clients[o.clientId].met).toBe(g.now);
  });

  it('an older save: met from its log, jobs and contracts on load', () => {
    const g = newGame();
    const [a, b, c] = Object.values(g.clients).filter((x) => !metClientIds(g).has(x.id));
    a.log = [[g.now - 30 * DAY, 4, 'Helped at short notice']];
    b.jobs = 2;
    b.firstJob = g.now - 60 * DAY;
    // As a save from before v0.24: no marker yet.
    delete g.stats.v024;
    loadRelations(g);
    expect(a.met).toBe(g.now - 30 * DAY);
    expect(b.met).toBe(g.now - 60 * DAY);
    expect(c.met).toBeUndefined();
    // Once only: a later load leaves the record as it is.
    c.jobs = 1;
    loadRelations(g);
    expect(c.met).toBeUndefined();
  });

  it('a visit is only to a client met; the list holds only those', () => {
    const g = newGame();
    const list = visitableClients(g);
    const met = metClientIds(g);
    expect(list.every((c) => met.has(c.id))).toBe(true);
    const stranger = Object.values(g.clients).find((c) => !met.has(c.id) && c.kind === 'airline' && !c.rivalId && c.ceased === undefined && c.base !== g.company.homeBase)!;
    expect(tripQuote(g, 'ceo', { clientId: stranger.id }).ok).toBe(false);
    expect(bookTrip(g, 'ceo', { clientId: stranger.id }).ok).toBe(false);
    stranger.met = g.now;
    expect(visitableClients(g).some((c) => c.id === stranger.id)).toBe(true);
  });
});
