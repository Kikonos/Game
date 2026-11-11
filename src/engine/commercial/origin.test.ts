// v0.20.1 leads vs tenders: where an offer or a contract came from, and the facts the cards show.

import { describe, expect, it } from 'vitest';
import type { Contract, ContractOffer, GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import '../sim';
import { LEAD_NOTE, TENDER_NOTE, contractOrigin, leadSourceLine, leadsView, offerOrigin } from '.';

const save = () => deserialize(fixture('v020-guiana'));
const offer = (g: GameState, id: string): ContractOffer => g.offers[id];

describe('v0.20.1 where a job came from', () => {
  it('an offer from the open market carries no tag', () => {
    const g = save();
    expect(offerOrigin(g, offer(g, 'o3z0k'))).toBeNull();
  });

  it('an offer that answers a lead says From lead, who brought it and the commission', () => {
    const g = save();
    const lead = g.com!.leads!.find((l) => l.brokerId === 'acs' && l.stage === 'lead')!;
    const o = { ...offer(g, 'o3z0k'), leadId: lead.id, brokerId: lead.brokerId };
    const v = offerOrigin(g, o)!;
    expect(v.label).toBe('From lead');
    expect(v.note).toBe('This offer answers our proposal on a lead through Air Charter Service. It is ours alone: no other operator is quoting. Air Charter Service takes 4 % commission if we sign.');
    const rep = g.com!.leads!.find((l) => !!l.repId)!;
    const name = g.com!.reps!.find((r) => r.id === rep.repId)!.name;
    expect(offerOrigin(g, { ...offer(g, 'o3z0k'), leadId: rep.id })!.note).toBe(`This offer answers our proposal on a lead found by ${name}. It is ours alone: no other operator is quoting.`);
  });

  it('a contract signed off a lead says From lead (also when the lead itself is long gone)', () => {
    const g = save();
    const tour = Object.values(g.contracts).find((c) => c.title === 'Pre-season tour to Toronto')!;
    expect(contractOrigin(g, tour)).toMatchObject({ origin: 'lead', label: 'From lead' });
    expect(contractOrigin(g, tour)!.note).toMatch(/^This job came from a lead through Air Charter Service: we sent a proposal and the client said yes\. Nobody else was asked\. Air Charter Service takes 4 % commission\.$/);
    const old: Contract = { ...tour, leadId: 'gone', brokerId: undefined };
    expect(contractOrigin(g, old)!.note).toBe('This job came from a lead: we sent a proposal and the client said yes. Nobody else was asked.');
    const market = Object.values(g.contracts).find((c) => !c.leadId)!;
    expect(contractOrigin(g, market)).toBeNull();
  });

  it('a tender we won: the offer and the contract say From tender, with how many we beat', () => {
    const g = save();
    const t = g.com!.tenders.find((x) => x.rivals.length === 3)!;
    t.status = 'won';
    t.result = { winner: 'us', why: 'best price', offerId: 'o3z0k' };
    const v = offerOrigin(g, offer(g, 'o3z0k'))!;
    expect(v.label).toBe('From tender');
    expect(v.note).toBe(`We won this in ${g.clients[t.clientId].name}’s tender against 3 other operators. It is signed at our bid, so there is no counter.`);
    const c = { ...Object.values(g.contracts)[0], id: 'kx', offerId: 'o3z0k', leadId: undefined };
    expect(contractOrigin(g, c)).toMatchObject({ origin: 'tender', label: 'From tender' });
    t.result.contractId = 'ky';
    expect(contractOrigin(g, { ...c, id: 'ky', offerId: 'other' })!.origin).toBe('tender');
  });

  it('a lead card names who found it: a broker with its commission, or the sales manager', () => {
    const g = save();
    const rows = leadsView(g);
    const broker = rows.find((l) => l.brokerId === 'acs')!;
    expect(leadSourceLine(g, broker)).toBe('Air Charter Service · 4 % commission');
    const rep = rows.find((l) => !!l.repId)!;
    expect(leadSourceLine(g, rep)).toBe(`${rep.sourceName}, sales manager`);
    expect(leadSourceLine(g, { source: 'fair' })).toBe('Trade fair');
  });

  it("the notes behind the '?' are short and plain", () => {
    for (const n of [TENDER_NOTE, LEAD_NOTE]) {
      expect(n.length).toBeLessThan(200);
      expect(n).not.toMatch(/§|RFP|firstRefusal/);
    }
    expect(TENDER_NOTE).toMatch(/^A contest\./);
    expect(LEAD_NOTE).toMatch(/^Just us\./);
  });
});
