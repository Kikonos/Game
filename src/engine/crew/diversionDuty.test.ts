// Crew-planning round (26 Oct 2026), seed 1: SK4002 ARN–OTP diverted to Cluj. Its crew's duty still held SK4003 OTP–ARN
// from Bucharest, where the aircraft never got to: the crew stayed "on duty" in Cluj for two days while the onward leg
// Cluj–Bucharest, crewed as a new trip, waited for a rescue crew six times (a hold loop). Settling the diversion now
// settles the duty: the crew fly on within their day, or rest at the alternate while the rest is re-crewed.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame, run } from '../contracts/testkit';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { resolveDecision } from '../ops';
import { devDisruption } from '../ops/disrupt';
import { flightCrewStatus } from './roster';
import { isRevenue } from '../ops/util';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';

const skip = (g: GameState, t: number) => advanceTo(g, t, new Set());

/** A charter LIS–FUE–LIS (or LIS–`to`–LIS; one duty, a turnaround there) three days out; its first leg diverts and lands. */
function diverted(seed: number, to = 'FUE', prep?: (g: GameState, crew: string[]) => void): { g: GameState; f: Flight; back: Flight; dutyId: string; crew: string[] } {
  const g = newGame(seed);
  const ac = leased(g);
  const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
  const o = legsOffer(g, [['LIS', to, t0 + 9 * 60], [to, 'LIS', t0 + 13 * 60]], 150);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const [f, back] = flightsOf(g, ac.id).filter((x) => x.contractId === r.data!.contractId && isRevenue(x));
  for (let i = 0; i < 400 && f.status === 'scheduled'; i++) {
    skip(g, Math.min(f.std + f.delay + 5, g.now + 60));
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  }
  expect(f.status).toBe('enroute');
  g.decisions.length = 0;
  expect(back.dutyId).toBe(f.dutyId);
  const dutyId = f.dutyId!;
  const crew = [...g.pairings[g.duties[dutyId].pairingId].slots.filter((s) => s.crewId).map((s) => s.crewId!)];
  expect(devDisruption(g, 'diversion', f.id)).toBe(true);
  const card = g.decisions.find((x) => x.kind === 'diversion')!;
  expect(resolveDecision(g, card.id, card.options.find((x) => x.id.startsWith('alt:'))!.id).ok).toBe(true);
  prep?.(g, crew);
  skip(g, (f.eta ?? f.sta) + 1);
  expect(f.status).toBe('done');
  return { g, f, back, dutyId, crew };
}

describe('a diversion settles the crew duty', () => {
  it('passengers coached on: the duty ends at the alternate, the crew rest there, and the trip completes without a hold loop', () => {
    for (const seed of [6, 5, 7, 8, 9]) {
      const { g, f, back, dutyId, crew } = diverted(seed, 'BCN');
      const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
      if (!on.options.some((o) => o.id === 'bus')) continue;
      expect(resolveDecision(g, on.id, 'bus').ok).toBe(true);
      // The duty ends at the alternate: released, its crew resting there, not on duty for a leg from Barcelona.
      run(g, g.now + 2 * 60);
      expect(g.duties[dutyId].done).toBe(true);
      expect(back.dutyId).not.toBe(dutyId);
      for (const id of crew) {
        expect(g.crew[id].status, `${g.crew[id].last}`).not.toBe('onDuty');
        expect(g.crew[id].loc).toBe(f.to);
      }
      run(g, back.std + 2 * DAY);
      expect(back.status === 'done' || back.status === 'cancelled').toBe(true);
      expect(back.crewTries ?? 0).toBeLessThanOrEqual(1);
      expect(g.stats.illegalFlown ?? 0).toBe(0);
      expect(g.stats.illegalCrewFlown ?? 0).toBe(0);
      return;
    }
    throw new Error('no diversion within coach reach');
  }, 120_000);

  it('fly on today: the crew who landed at the alternate fly the onward leg within their day', () => {
    for (const seed of [6, 5, 7, 8]) {
      const { g, f, dutyId, crew } = diverted(seed);
      const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
      if (!on.options.some((o) => o.id === 'flyOn') || !on.options.find((o) => o.id === 'flyOn')!.chips?.some((c) => /Same crew/.test(c))) continue;
      expect(resolveDecision(g, on.id, 'flyOn').ok).toBe(true);
      const cont = g.flights[f.contOf!];
      expect(cont.dutyId).toBe(dutyId);
      run(g, cont.sta + 3 * 60);
      expect(cont.status).toBe('done');
      expect(cont.crewIds.filter((id) => crew.includes(id)).length).toBe(crew.length);
      expect(g.stats.illegalFlown ?? 0).toBe(0);
      return;
    }
    throw new Error('no diversion whose crew could fly on');
  }, 120_000);
  it('a save from before the fix (the duty still holding the leg from the planned destination): settled on load', () => {
    for (const seed of [6, 5, 7, 8, 9]) {
      const { g, back, dutyId, crew } = diverted(seed, 'BCN');
      // As the old game left it: the onward card gone (passengers coached), the duty untouched.
      g.decisions = g.decisions.filter((x) => x.kind !== 'divertOnward');
      const h = deserialize(serialize(g));
      expect(h.duties[dutyId].flightIds).not.toContain(back.id);
      run(h, h.now + 2 * 60);
      expect(h.duties[dutyId].done).toBe(true);
      for (const id of crew) expect(h.crew[id].status).not.toBe('onDuty');
      return;
    }
  }, 120_000);

  // v0.12.1 (review, MOVE-1/EV-08): "Hotels and a rest, fly at 00:39 UTC: the crew get their legal rest, then fly" while
  // the captain was due his 36 h weekly rest; the leg had no pilots and two later legs were cancelled. The option now
  // says who really flies it (tried on a copy, by the rule the answer uses) and when.
  it('the hotel option says who flies the onward leg, and it holds after the answer', () => {
    let seen = 0;
    for (const seed of [6, 5, 7, 8, 9]) {
      const { g, f, crew } = diverted(seed, 'BCN');
      const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
      const hotel = on.options.find((o) => o.id === 'hotel')!;
      const chips = hotel.chips ?? [];
      const own = chips.includes('Same crew after their rest');
      const fresh = chips.some((c) => c.startsWith('Fresh crew'));
      expect(own || fresh || chips.includes('No crew yet')).toBe(true);
      expect(resolveDecision(g, on.id, 'hotel').ok).toBe(true);
      const x = g.flights[f.contOf!];
      expect(x.std).toBe(Number(on.data!.morning));
      if (!own && !fresh) continue;
      seen++;
      const st = flightCrewStatus(g, x.id).level;
      expect(st === 'missing' || st === 'illegal', `seed ${seed}: ${st}`).toBe(false);
      const on2 = g.pairings[g.duties[x.dutyId!].pairingId].slots.filter((s) => s.crewId).map((s) => s.crewId!);
      if (own) expect(on2.every((id) => crew.includes(id))).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('a crew due their weekly rest is not promised for the morning leg', () => {
    // Their last 36 h rest was long ago: the 168 h limit runs out before the morning (ORO.FTL.235(d)).
    const { g } = diverted(6, 'BCN', (h, crew) => {
      for (const id of crew) h.crew[id].lastRecovery = h.now - 150 * 60;
    });
    const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
    const hotel = on.options.find((o) => o.id === 'hotel')!;
    expect(hotel.chips).not.toContain('Same crew after their rest');
    expect(hotel.desc).not.toMatch(/the crew get their legal rest, then fly/);
  });
});

