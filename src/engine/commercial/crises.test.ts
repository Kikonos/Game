// v0.14 client crises: a strike, an engine grounding, an administration (receivables written off, a claim paid back
// later), each a world event with its own work; the four-line card; pacing (busy days, the pace's gap, one at a time).

import { describe, expect, it } from 'vitest';
import { takeCues } from '../core/cues';
import { invoice } from '../core/ledger';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { newGame } from '../contracts/testkit';
import { newDirector } from '../ops/director';
import { onWorldEnd, worldEvent } from '../ops/world';
import { problemAt } from '../problems';
import { CRISIS, clientCrisisCard, dailyCrises, startCrisis } from './crises';
import { clientByName, com } from './state';
import './index';

const byName = (g: GameState, n: string) => clientByName(g, n)!;
const badDebt = (g: GameState) => [...g.finance.history, g.finance.current].reduce((s, m) => s + (m.lines.badDebt ?? 0), 0);

describe('a strike', () => {
  it('is a world event in the news with urgent cover work for the airline', () => {
    const g = newGame(41);
    const cl = byName(g, 'Eurowings');
    const x = startCrisis(g, 'strike', cl.id)!;
    expect(x).toBeTruthy();
    const e = worldEvent(g, x.eventId)!;
    expect(e.kind).toBe('strike');
    expect(e.title).toMatch(/Eurowings (pilots|cabin crew) strike/);
    expect(e.title).toMatch(/Vereinigung Cockpit|UFO/);
    expect(g.world!.events.find((v) => v.id === x.eventId)!.offerIds.length).toBeGreaterThan(0);
    expect(g.messages[0].title).toBe(e.title);
    // A client we never worked with: the news only (silent, no card).
    expect(g.messages[0].topic).toBe('world');
  });

  it('a strike at a client we work with posts the four-line card and chimes', () => {
    const g = newGame(42);
    const cl = byName(g, 'Condor');
    cl.relation = 30;
    takeCues();
    const x = startCrisis(g, 'strike', cl.id)!;
    const card = clientCrisisCard(g, x.eventId)!;
    expect(card.what).toBe('Condor is on strike');
    expect(card.why.length).toBeGreaterThan(10);
    expect(card.hurt.text).toMatch(/^No: /);
    expect(card.actions.length).toBeGreaterThan(0);
    expect(g.messages[0].problem?.kind).toBe('clientCrisis');
    expect(takeCues()).toContain('worldEventOurs');
    expect(problemAt(g, { kind: 'event', id: x.eventId })?.subject.kind).toBe('clientCrisis');
  });
});

describe('an engine grounding', () => {
  it('names the engine and the aircraft grounded, with a short wet lease and cover', () => {
    const g = newGame(43);
    const cl = byName(g, 'Wizz Air');
    const x = startCrisis(g, 'grounding', cl.id)!;
    expect(x.engine).toMatch(/GTF/);
    expect(x.grounded).toBeGreaterThan(0);
    const e = g.world!.events.find((v) => v.id === x.eventId)!;
    expect(e.kind).toBe('engineCrisis');
    expect(e.offerIds.length).toBeGreaterThan(0);
    expect(e.offerIds.every((id) => g.offers[id].eventId === e.id)).toBe(true);
    expect(g.market.shocks!.some((s) => s.eventId === e.id)).toBe(true);
  });
});

describe('an administration', () => {
  it('never a client we fly for; open invoices written off as bad debt; a claim pays back part later', () => {
    const g = newGame(44);
    const cl = byName(g, 'Croatia Airlines');
    const r = invoice(g, { clientId: cl.id, contractId: null, desc: 'June block hours', amount: 200_000, cat: 'acmiRevenue', dueDays: 30 });
    const debt0 = badDebt(g);
    takeCues();
    const x = startCrisis(g, 'bankruptcy', cl.id)!;
    expect(x.written).toBe(200_000);
    expect(r.written).toBe(true);
    expect(r.paid).not.toBeNull();
    expect(badDebt(g) - debt0).toBe(-200_000);
    expect(g.clients[cl.id].ceased).toBe(g.now);
    expect(takeCues()).toContain('clientCollapse');
    const card = clientCrisisCard(g, x.eventId)!;
    expect(card.severity).toBe('red');
    expect(card.hurt.text).toMatch(/^Yes: \$200K/);
    // The claim: 10–30 % back months later.
    const cash = g.company.cash;
    g.now = x.claim!.payAt;
    dailyCrises(g);
    expect(x.claim!.paid).toBe(x.claim!.payAt);
    expect(g.company.cash - cash).toBe(x.claim!.amount);
    expect(g.messages[0].title).toMatch(/administrator of Croatia Airlines paid/);
    expect(x.claim!.amount).toBeGreaterThanOrEqual(200_000 * CRISIS.claimPct[0] - 1);
    expect(x.claim!.amount).toBeLessThanOrEqual(200_000 * CRISIS.claimPct[1] + 1);
  });

  it('skips a client with a live contract of ours, and the failed airline sends no more offers', () => {
    const g = newGame(45);
    const cl = byName(g, 'Bulgaria Air');
    g.contracts.kx = { id: 'kx', clientId: cl.id, status: 'active' } as never;
    expect(startCrisis(g, 'bankruptcy', cl.id)).toBeNull();
    delete g.contracts.kx;
    startCrisis(g, 'bankruptcy', cl.id);
    expect(Object.values(g.offers).filter((o) => o.clientId === cl.id && o.status === 'open').length).toBe(0);
  });

  it('the world event ends cleanly', () => {
    const g = newGame(46);
    const x = startCrisis(g, 'strike', byName(g, 'TAP Air Portugal').id)!;
    const e = g.world!.events.find((v) => v.id === x.eventId)!;
    g.now = e.end;
    onWorldEnd(g, { t: e.end, seq: 0, type: 'world.end', id: e.id, v: 0 });
    expect(e.done).toBe(true);
  });
});

describe('pacing', () => {
  it('only on busy days, never in the first weeks, one at a time, the pace gap apart', () => {
    const g = newGame(47);
    newDirector(g, 'normal');
    const start = g.now;
    let quiet = 0;
    for (let d = 0; d < 365; d++) {
      const before = com(g).crises.length;
      dailyCrises(g);
      if (com(g).crises.length > before) {
        const s = g.director!.spells.find((v) => v[0] <= g.now && g.now < v[1])!;
        if (s[2] === 0) quiet++;
        expect(g.now - start).toBeGreaterThanOrEqual(CRISIS.calmStart * DAY);
      }
      g.now += DAY;
    }
    const xs = com(g).crises;
    expect(quiet).toBe(0);
    expect(xs.length).toBeGreaterThanOrEqual(2);
    expect(xs.length).toBeLessThanOrEqual(9);
    for (let i = 1; i < xs.length; i++) expect(xs[i].start - xs[i - 1].start).toBeGreaterThanOrEqual(CRISIS.gap.normal * DAY);
  });

  it('Calm pace has fewer crises than Busy', () => {
    const count = (pace: 'calm' | 'busy') => {
      const g = newGame(48);
      newDirector(g, pace);
      for (let d = 0; d < 365; d++, g.now += DAY) dailyCrises(g);
      return com(g).crises.length;
    };
    expect(count('calm')).toBeLessThan(count('busy'));
  });
});
