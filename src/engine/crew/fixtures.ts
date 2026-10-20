// Test fixtures for the crew module (not used by the game): a wet season base, crew additions, checks.

import { addFlight } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY, localOffset } from '../core/time';
import type { Contract, GameState, Minute, Role } from '../core/types';
import { createGame } from '../newGame';
import { makeCrewMember } from './generate';

export const fixtureGame = (seed = 5): GameState =>
  createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

/** A contract record for crew tests (B1 builds real ones). */
export function fixtureContract(g: GameState, over: Partial<Contract> & Pick<Contract, 'pattern' | 'aircraftIds' | 'start' | 'end'>): Contract {
  const c: Contract = {
    id: `k${Object.keys(g.contracts).length + 1}`, offerId: 'o', archetype: 'seasonBase', clientId: 'cl', title: 'Fixture',
    product: { kind: 'wet', ratePerBH: 3000, mghPerMonth: 200, excessRate: 2800, cycleFee: 900, positioningBillable: true },
    requirements: { minSeats: 150, longestSectorNm: 0, minRunwayM: 0, etops: 0, approvals: [], extraCabin: 0 },
    penalties: { cancelScale: [], perDelay: 0, perCancelledLeg: 0 }, payment: { basis: 'arrears', dueDays: 30, depositPct: 0 },
    effects: {}, signed: g.now, status: 'active', generatedUntil: over.end, use: {}, billedMonths: [], color: 0, balanceAt: null,
    ...over,
  };
  g.contracts[c.id] = c;
  return c;
}

/**
 * A wet season base (DESIGN §5.1.6, simplified): out-and-back waves from `base` to `dest` for `days` days from the
 * next local midnight, a maintenance night (last wave dropped) every 7 days, then rotations dropped evenly to land
 * near `targetBH` per month.
 */
export function seasonBase(g: GameState, acId: string, base: string, dest: string, waves: number[], days: number, targetBH = 220): Contract {
  const ac = g.fleet[acId];
  ac.at = base;
  const t0 = Math.ceil((g.now + localOffset(base, g.now)) / DAY) * DAY + DAY;
  const start = t0 - localOffset(base, t0);
  const contract = fixtureContract(g, { aircraftIds: [acId], start, end: start + days * DAY, pattern: { kind: 'base', base, dests: [dest], from: start, to: start + days * DAY, targetBH, waves, prefix: 'NB', maintEvery: 7 } });
  const out = blockMinutes(ac.typeId, base, dest);
  const back = blockMinutes(ac.typeId, dest, base);
  const turn = typeOf(ac.typeId).turnMin;
  const rot = out + back;
  const plan: number[][] = [];
  for (let k = 0; k < days; k++) plan.push((k + 1) % 7 === 0 ? waves.slice(0, -1) : [...waves]);
  const full = plan.reduce((n, w) => n + w.length, 0) * rot;
  const target = (targetBH * 60 * days) / 30.44;
  const n = Math.max(0, Math.round((full - target) / rot));
  for (let k = 1; k < days - 1; k++) {
    let drop = Math.floor(((k + 1) * n) / days) - Math.floor((k * n) / days);
    if (n > days && plan[k].length > 1) drop += 1;
    while (drop-- > 0 && plan[k].length > 1) plan[k].pop();
  }
  let no = 100;
  for (let k = 0; k < days; k++) {
    for (const w of plan[k]) {
      const localStd = start + k * DAY + localOffset(base, start + k * DAY) + w;
      const std = localStd - localOffset(base, localStd);
      addFlight(g, { no: `NB${no++}`, aircraftId: acId, contractId: contract.id, kind: 'revenue', from: base, to: dest, std, sta: std + out });
      const bstd = std + out + turn;
      addFlight(g, { no: `NB${no++}`, aircraftId: acId, contractId: contract.id, kind: 'revenue', from: dest, to: base, std: bstd, sta: bstd + back });
    }
  }
  return contract;
}

/** Adds crew at base (rated on the family) and returns their ids. */
export function addCrew(g: GameState, counts: Partial<Record<Role, number>>, family: Parameters<typeof makeCrewMember>[2] = 'A320', base = g.company.homeBase): string[] {
  const ids: string[] = [];
  for (const [role, n] of Object.entries(counts) as [Role, number][]) {
    for (let i = 0; i < n; i++) {
      const c = makeCrewMember(g, role, family, base);
      g.crew[c.id] = c;
      ids.push(c.id);
    }
  }
  return ids;
}

export const at = (g: GameState, days: number, hhmm = 0): Minute => Math.floor(g.now / DAY) * DAY + days * DAY + hhmm;
