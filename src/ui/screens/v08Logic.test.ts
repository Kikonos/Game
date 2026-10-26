import { describe, expect, it } from 'vitest';
import { dryMoney, ourCabin, v08Chips } from './v08Logic';
import type { ContractOffer, GameState } from '../../engine/core/types';
import { actionTarget } from '../components/problemLogic';
import { refTarget } from './screenLogic';

const base = { requirements: { minSeats: 150 } as ContractOffer['requirements'], product: { kind: 'wet', ratePerBH: 4000 } as ContractOffer['product'] };

describe('v0.8 offer chips', () => {
  it('level first, then competition, at most 4', () => {
    const c = v08Chips({ ...base, standingPct: -0.08, repeatOf: 'k1', eventId: 'e1', requirements: { ...base.requirements, clientCabin: { n: 6, of: 8, leads: false } } }, { level: 'trusted', chip: 'Trusted · +8 %' }, 'strong');
    expect(c.map((x) => x.label)).toEqual(['Trusted · +8 %', 'Rivals bidding', 'Client crew 6 of 8', 'Repeat business']);
    expect(c[0].tone).toBe('good');
  });
  it('first refusal replaces competition; newcomer chip when room', () => {
    const c = v08Chips({ ...base, firstRefusal: true, standingPct: -0.08 }, { level: 'new', chip: 'New client' }, 'strong');
    expect(c.map((x) => x.label)).toEqual(['New client', 'First refusal', 'Newcomer −8 %']);
  });
});

describe('ourCabin', () => {
  it('drops CC first and keeps the purser unless they lead', () => {
    expect(ourCabin({ n: 6, of: 8, leads: false })).toEqual(['PUR', 'CC']);
    expect(ourCabin({ n: 7, of: 8, leads: false })).toEqual(['PUR']);
    expect(ourCabin({ n: 8, of: 8, leads: true })).toEqual([]);
    expect(ourCabin({ n: 4, of: 8, leads: true })).toEqual(['CC', 'CC', 'CC', 'CC']);
  });
});

describe('dryMoney', () => {
  it('rent, reserves at expected hours, consent off', () => {
    const m = dryMoney({ product: { kind: 'dry', rentPerMonth: 238_000, reservesPerFH: 420 }, dry: { site: 'LAD', fhPerMonth: 230, deposit: 238_000, consent: 20_000, months: 5 } });
    expect(m).toMatchObject({ rent: 1_190_000, fh: 1150, reserves: 483_000, total: 1_190_000 + 483_000 - 20_000 });
  });
});


describe('v0.8 links', () => {
  const g = {} as GameState;
  it('card actions open the client, rival, world-event and outlook dialogs', () => {
    expect(actionTarget(g, { id: 'c', label: 'x', open: { modal: 'client', id: 'c1' } })).toEqual({ modal: { kind: 'client', clientId: 'c1' } });
    expect(actionTarget(g, { id: 'r', label: 'x', open: { modal: 'rival', id: 'r1' } })).toEqual({ modal: { kind: 'rival', rivalId: 'r1' } });
    expect(actionTarget(g, { id: 'w', label: 'x', open: { modal: 'worldEvent', id: 'e1' } })).toEqual({ modal: { kind: 'worldEvent', eventId: 'e1' } });
    expect(actionTarget(g, { id: 'o', label: 'x', open: { modal: 'outlook', id: '' } })).toEqual({ modal: { kind: 'outlook' } });
  });
  it('inbox refs lead to Company › Clients / Rivals and the map', () => {
    expect(refTarget(g, { kind: 'client', id: 'c1' })).toEqual({ tab: 'contracts', view: 'clients', sel: { kind: 'client', id: 'c1' } });
    expect(refTarget(g, { kind: 'rival', id: 'r1' })).toEqual({ tab: 'company', view: 'rivals', sel: { kind: 'rival', id: 'r1' } });
    expect(refTarget(g, { kind: 'event', id: 'e1' })).toEqual({ tab: 'map', sel: { kind: 'event', id: 'e1' } });
  });
});
