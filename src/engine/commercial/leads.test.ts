// v0.16 the leads pipeline (UPDATE-0.16.md §C.3): lead → proposal → negotiation → signed, or cold / lost. A lead waits
// 14 days for a proposal (the amber card and its message 3 days before), a proposal is answered in 2–7 days on a busy
// day (an offer on the market carrying the lead, asked of us by name, or lost with a reason), the desk works 3 at once,
// a signed offer closes the lead, a dropped one is lost.

import { describe, expect, it } from 'vitest';
import './index';
import { BAL } from '../core/balance';
import { takeCues } from '../core/cues';
import { DAY } from '../core/time';
import type { Client, GameState, Lead } from '../core/types';
import { acceptOffer } from '../contracts/accept';
import { feasibility } from '../contracts/feasibility';
import { newGame } from '../contracts/testkit';
import { problemFor, problems } from '../problems';
import { director } from '../ops/director';
import { dailySales, dropLead, fairLead, leadColdCard, leadsView, workLead, workedCap, workedNow } from './sales';
import { com } from './state';

const L = BAL.v016.sales.lead;

function busy(g: GameState): void {
  director(g).spells = [[g.now - DAY, g.now + 900 * DAY, 1]];
}
function days(g: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    g.now += DAY;
    dailySales(g);
  }
}
/** Clients who can carry a lead (tour operators and airlines; a far-flung one may draft no sensible job: skipped). */
function clients(g: GameState, n: number): Client[] {
  return Object.values(g.clients).filter((c) => (c.kind === 'tourOperator' || c.kind === 'airline') && !c.rivalId && c.country !== 'US').slice(0, n);
}
function lead(g: GameState, c: Client, key = 't1'): Lead {
  let l = fairLead(g, c, key, 'ITB Berlin');
  for (const x of Object.values(g.clients)) {
    if (l) break;
    if (x.kind === 'tourOperator' && x.id !== c.id) l = fairLead(g, x, key, 'ITB Berlin');
  }
  expect(l).not.toBeNull();
  return l!;
}

describe('a lead', () => {
  it('waits 14 days for a proposal: the amber card and its message 3 days before, then it goes cold', () => {
    const g = newGame(1);
    busy(g);
    const l = lead(g, clients(g, 1)[0]);
    const c = g.clients[l.clientId];
    expect(l).toMatchObject({ stage: 'lead', source: 'fair', clientId: c.id });
    expect(l.expires - l.created).toBe(L.coldDays * DAY);
    expect(l.value).toBeGreaterThan(0);
    expect(l.title).toBeTruthy();
    expect(l.why).toContain('Met at ITB Berlin');
    expect(leadsView(g)[0]).toMatchObject({ stageName: 'Lead', daysLeft: L.coldDays, sourceName: 'Trade fair' });
    expect(leadColdCard(g, l.id)).toBeNull();
    takeCues();
    days(g, L.coldDays - L.warnDays);
    const card = leadColdCard(g, l.id)!;
    expect(card).not.toBeNull();
    expect(card.severity).toBe('amber');
    expect(card.what).toBe(`${c.name}'s lead goes cold in 3 days`);
    expect(card.why).toMatch(/^Nobody has sent them a proposal since /);
    expect(card.hurt.text).toBeTruthy();
    expect(card.actions[0]).toMatchObject({ label: 'Send proposal', open: { tab: 'contracts', view: 'sales', sel: { kind: 'lead', id: l.id } } });
    expect(card.by).toBe(l.expires);
    expect(problems(g).some((p) => p.subject.kind === 'leadCold' && p.subject.ref.id === l.id)).toBe(true);
    expect(problemFor(g, { kind: 'leadCold', ref: { kind: 'lead', id: l.id } })).not.toBeNull();
    const warn = g.messages.filter((m) => m.problem?.kind === 'leadCold');
    expect(warn).toHaveLength(1);
    expect(warn[0].title).toBe(card.what);
    expect(takeCues()).toContain('notice');
    days(g, 2);
    expect(g.messages.filter((m) => m.problem?.kind === 'leadCold')).toHaveLength(1);
    expect(l.stage).toBe('lead');
    days(g, 1);
    expect(l.stage).toBe('cold');
    expect(g.stats.v016!.leadsCold).toBe(1);
    expect(g.messages.some((m) => m.title.startsWith(`Lead gone cold: ${c.name}`))).toBe(true);
    expect(leadColdCard(g, l.id)).toBeNull();
    expect(leadsView(g)[0].stageName).toBe('Went cold');
    // Pruned a month after it closed.
    days(g, 31);
    expect(com(g).leads).toHaveLength(0);
  });

  it('can be dropped while it is a lead or a proposal', () => {
    const g = newGame(2);
    const [a, b] = clients(g, 2);
    const l1 = lead(g, a, 'd1'), l2 = lead(g, b, 'd2');
    expect(dropLead(g, l1.id).ok).toBe(true);
    expect(l1.stage).toBe('lost');
    expect(l1.why).toBe('We dropped it.');
    expect(workLead(g, l2.id).ok).toBe(true);
    expect(dropLead(g, l2.id).ok).toBe(true);
    expect(dropLead(g, l2.id).ok).toBe(false);
    expect(dropLead(g, 'nope').ok).toBe(false);
  });
});

describe('a proposal', () => {
  it('the desk works 3 at once (3 more per sales manager)', () => {
    const g = newGame(3);
    const cs = clients(g, 5);
    const ls = cs.map((c, i) => lead(g, c, `c${i}`));
    expect(workedCap(g)).toBe(L.workedBase);
    for (let i = 0; i < L.workedBase; i++) expect(workLead(g, ls[i].id).ok).toBe(true);
    const r = workLead(g, ls[L.workedBase].id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/already working 3 proposals/);
    expect(workedNow(g)).toBe(L.workedBase);
    expect(workLead(g, ls[0].id).ok).toBe(false);
    const p = ls[0];
    expect(p.stage).toBe('proposal');
    const d = (p.expires - p.moved) / DAY;
    expect(d).toBeGreaterThanOrEqual(L.replyDays[0]);
    expect(d).toBeLessThanOrEqual(L.replyDays[1]);
  });

  it('is answered in 2–7 days: an offer on the market carrying the lead, asked of us by name, or lost with a reason', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 16; seed++) {
      const g = newGame(seed);
      busy(g);
      const l = lead(g, clients(g, 3)[seed % 3], `p${seed}`);
      const c = g.clients[l.clientId];
      expect(workLead(g, l.id).ok).toBe(true);
      const sent = g.now;
      takeCues();
      days(g, L.replyDays[1]);
      expect(['negotiation', 'lost']).toContain(l.stage);
      expect(l.moved - sent).toBeGreaterThanOrEqual(L.replyDays[0] * DAY);
      seen.add(l.stage);
      if (l.stage === 'negotiation') {
        const o = g.offers[l.offerId!];
        expect(o).toBeDefined();
        expect(o.leadId).toBe(l.id);
        expect(o.clientId).toBe(c.id);
        expect(o.status).toBe('open');
        expect(o.firstRefusal).toBe(true);
        expect(o.rivalBid).toBeUndefined();
        expect(o.call).toBeUndefined();
        expect(o.expires - l.moved).toBeGreaterThanOrEqual(Math.min(5 * DAY, o.start - 12 * 60 - l.moved) - 1);
        expect(o.blurb).toMatch(/^After our proposal: .* said yes in principle\./);
        expect(l.expires).toBe(o.expires);
        expect(g.messages.some((m) => m.title.startsWith(`${c.name} says yes in principle`) && m.ref?.id === o.id)).toBe(true);
        expect(takeCues()).toContain('offerNew');
        expect(leadsView(g)[0]).toMatchObject({ stageName: 'Offer on the market', offerOpen: true });
      } else {
        expect(l.why).toMatch(/\.$/);
        expect(g.messages.some((m) => m.title.startsWith(`No deal: ${c.name}`))).toBe(true);
        expect(g.stats.v016!.leadsLost).toBe(1);
      }
    }
    expect(seen).toEqual(new Set(['negotiation', 'lost']));
  });

  it('signing the offer signs the lead; an offer that closes without a contract loses it', () => {
    let signed = 0, lost = 0;
    for (let seed = 1; seed <= 16 && (!signed || !lost); seed++) {
      const g = newGame(seed);
      busy(g);
      const l = lead(g, clients(g, 3)[seed % 3], `s${seed}`);
      workLead(g, l.id);
      days(g, L.replyDays[1]);
      if (l.stage !== 'negotiation') continue;
      const o = g.offers[l.offerId!];
      if (!signed) {
        const ac = Object.values(g.fleet).find((a) => feasibility(g, o.id, a.id, { quick: true }).level !== 'no');
        if (!ac || !acceptOffer(g, o.id, [ac.id]).ok) continue;
        const ct = Object.values(g.contracts).find((x) => x.leadId === l.id)!;
        expect(ct).toBeDefined();
        dailySales(g);
        expect(l.stage).toBe('signed');
        expect(l.contractId).toBe(ct.id);
        expect(g.stats.v016!.leadsSigned).toBe(1);
        expect(leadsView(g)[0].stageName).toBe('Signed');
        signed++;
      } else {
        o.status = 'declined';
        dailySales(g);
        expect(l.stage).toBe('lost');
        expect(l.why).toBe('We declined their offer.');
        expect(dropLead(g, l.id).ok).toBe(false);
        lost++;
      }
    }
    expect(signed).toBe(1);
    expect(lost).toBe(1);
  });
});
