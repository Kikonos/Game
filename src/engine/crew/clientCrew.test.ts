// v0.8 mixed crew (UPDATE-0.8.md §7, §14): the client's cabin crew take seats (CC first, the purser seat only when
// their senior leads), our roster fills only our share, the board shows their rows, the rate falls $75 a head.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { Role } from '../core/types';
import { devMixedCrew } from '../contracts/missions';
import { newGame } from '../contracts/testkit';
import { clientCrewOf, clientCrewRows, clientRoles, dropClientSeats, mixedCrewCut, mixedCrewFlavour, mixedCrewText } from './clientCrew';

const seats = (...roles: Role[]) => roles.map((role, i) => ({ role, i }));

describe('client seats (§7.1)', () => {
  it('drops cabin crew first and the purser only when their senior leads', () => {
    const full = seats('CPT', 'FO', 'PUR', 'CC', 'CC', 'CC');
    expect(dropClientSeats(full, { n: 2, of: 4, leads: false }).map((s) => s.role)).toEqual(['CPT', 'FO', 'PUR', 'CC']);
    expect(dropClientSeats(full, { n: 2, of: 4, leads: true }).map((s) => s.role)).toEqual(['CPT', 'FO', 'CC', 'CC']);
    // Never pilots, even when asked for more than the cabin.
    expect(dropClientSeats(full, { n: 9, of: 4, leads: false }).map((s) => s.role)).toEqual(['CPT', 'FO', 'PUR']);
    expect(dropClientSeats(full, undefined)).toBe(full);
    expect(clientRoles({ n: 3, of: 4, leads: true })).toEqual(['PUR', 'CC', 'CC']);
    expect(clientRoles({ n: 2, of: 4, leads: false })).toEqual(['CC', 'CC']);
  });

  it('the rate cut and the offer lines', () => {
    expect(mixedCrewCut({ n: 6, of: 8, leads: false })).toBe(6 * BAL.v08.mixedCrew.perCabinBH);
    expect(mixedCrewCut(undefined)).toBe(0);
  });
});

describe('a mixed-crew base (§7.2)', () => {
  it('our roster fills only our share; the board shows the client rows; the text names the split', () => {
    const g = newGame(3);
    const dutyId = devMixedCrew(g);
    expect(dutyId).not.toBe('');
    const d = g.duties[dutyId];
    const p = g.pairings[d.pairingId];
    const k = g.contracts[p.contractId!];
    const cc = k.requirements.clientCabin!;
    expect(cc.leads).toBe(false);
    expect(cc.n).toBe(cc.of - 1);
    // Our cabin seats: the purser only.
    const cabin = p.slots.filter((s) => s.role === 'PUR' || s.role === 'CC');
    expect(cabin.map((s) => s.role)).toEqual(['PUR']);
    expect(p.slots.filter((s) => s.role === 'CPT').length).toBeGreaterThanOrEqual(1);
    // The roster fills those seats (within the horizon) and nothing more.
    const filled = p.slots.filter((s) => s.crewId);
    expect(filled.length).toBeLessThanOrEqual(p.slots.length);
    // Views.
    const who = clientCrewOf(g, dutyId)!;
    expect(who.n).toBe(cc.n);
    expect(who.label).toBe('Air Sénégal cabin crew');
    expect(who.roles.every((r) => r === 'CC')).toBe(true);
    const rows = clientCrewRows(g, g.now, g.now + 30 * DAY);
    const row = rows.find((r) => r.key === k.id)!;
    expect(row.label).toBe(`Air Sénégal · ${cc.n} per flight`);
    expect(row.blocks.length).toBeGreaterThan(0);
    expect(row.blocks.every((b) => b.kind === 'duty')).toBe(true);
    expect(mixedCrewText(g, k.id)).toBe(`Air Sénégal provides ${cc.n} of ${cc.of} cabin crew; we fly the purser. −$${(75 * cc.n).toLocaleString('en-US')} a block hour.`);
    expect(mixedCrewFlavour(g, k.id)[0]).toMatch(/French/);
  });
});
