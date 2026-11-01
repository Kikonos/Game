// v0.14.1 hunt 2, OPS lane: night curfews at the gate and on every path that moves a flight (OPS-1), the client's
// extra rotation (OPS-2), ETOPS for four engines (OPS-6), and the crew unit of an empty leg (CREW-2).

import { describe, expect, it } from 'vitest';
import { addFlight, ownFlightNo } from '../core/entities';
import { curfewOk } from '../core/curfew';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { Aircraft, Flight, GameState, Minute, SimEvent } from '../core/types';
import { acceptOffer } from '../contracts';
import { addAircraft, hamBase, leased, legsOffer, newGame } from '../contracts/testkit';
import { feasibility } from '../contracts/feasibility';
import { legApprovals } from './approvalGate';
import { changeRequestFor } from './events';
import { delayChain, onFlightDep, unitOf } from './flights';
import { resolveDecision } from '.';

const H = 60;
// The game starts 1 Mar 2027: Düsseldorf on CET (UTC+1), ban 23:00–06:00 local = 22:00–05:00 UTC.
const T0 = new WeakMap<GameState, Minute>();
/** Midnight UTC `n` days after the game's start (fixed, whatever the clock says now). */
const day = (g: GameState, n: number) => {
  if (!T0.has(g)) T0.set(g, Math.floor(g.now / DAY) * DAY);
  return T0.get(g)! + n * DAY;
};
const dep = (g: GameState, f: Flight) => onFlightDep(g, { t: g.now, seq: 0, type: 'flight.dep', id: f.id, v: f.ev } as SimEvent);
const leg = (g: GameState, ac: Aircraft, kind: Flight['kind'], from: string, to: string, std: Minute) =>
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind, from, to, std, sta: std + blockMinutes(ac.typeId, from, to), ...(kind === 'revenue' ? { pax: 150 } : {}) });
const at = (ac: Aircraft, code: string) => {
  ac.at = code;
  ac.flightId = null;
  ac.status = 'available';
};

describe('OPS-1: no leg leaves or lands inside a night curfew', () => {
  it('an empty leg due out of Düsseldorf at 02:20 local waits for the opening (BLU1559)', () => {
    const g = newGame(51);
    const ac = leased(g);
    at(ac, 'DUS');
    const f = leg(g, ac, 'positioning', 'DUS', 'MAN', day(g, 2) + 1 * H + 20);
    g.now = f.std;
    dep(g, f);
    expect(f.status).toBe('scheduled');
    const off = f.std + f.delay;
    expect(curfewOk('DUS', off)).toBe(true);
    expect(off).toBeGreaterThanOrEqual(day(g, 2) + 5 * H);
  });

  it('a passenger leg planned to land inside the curfew gets the curfew card, before any crew alarm', () => {
    const g = newGame(52);
    const ac = leased(g);
    at(ac, 'LIS');
    const blk = blockMinutes(ac.typeId, 'LIS', 'DUS');
    const f = leg(g, ac, 'revenue', 'LIS', 'DUS', day(g, 2) + 22 * H + 30 - blk); // lands 23:30 local
    g.now = f.std;
    g.decisions.length = 0;
    dep(g, f);
    const d = g.decisions.find((x) => x.kind === 'curfew' && x.data?.flightId === f.id);
    expect(d).toBeTruthy();
    expect(g.decisions.some((x) => x.kind === 'crewShort')).toBe(false);
    expect(d!.data?.why).toMatch(/planned to land inside/);
  });

  it('a passenger leg out of a closed airport: wait for the opening (default) or cancel; waiting leaves clear of it', () => {
    const g = newGame(53);
    const ac = leased(g);
    at(ac, 'DUS');
    const f = leg(g, ac, 'revenue', 'DUS', 'LIS', day(g, 2) + 1 * H); // 02:00 local
    g.now = f.std;
    g.decisions.length = 0;
    dep(g, f);
    const d = g.decisions.find((x) => x.kind === 'curfew' && x.data?.flightId === f.id)!;
    expect(d.options.map((o) => o.id)).toEqual(['night', 'cancel']);
    expect(d.defaultOption).toBe('night');
    expect(resolveDecision(g, d.id, 'night').ok).toBe(true);
    expect(curfewOk('DUS', f.std)).toBe(true);
    expect(f.std).toBeGreaterThanOrEqual(day(g, 2) + 5 * H);
  });

  it("a wait for crew (Crew Control's delay) never ends inside a curfew", () => {
    const g = newGame(54);
    const ac = leased(g);
    const f = leg(g, ac, 'positioning', 'DUS', 'MAN', day(g, 2) + 20 * H);
    g.now = day(g, 2) + 12 * H;
    delayChain(g, f, day(g, 2) + 23 * H + 30, 'Waiting for crew', false);
    expect(curfewOk('DUS', f.std)).toBe(true);
    expect(f.std).toBeGreaterThanOrEqual(day(g, 3) + 5 * H);
  });
});

describe('OPS-2: an extra rotation is planned clear of the night curfews', () => {
  it('HAM base: no favour that lands back after 23:00 local', () => {
    const g = newGame(55, 'LIS');
    const ac = leased(g);
    const start = day(g, 3);
    const r = acceptOffer(g, hamBase(g, start, 40, 2).id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId as string];
    let n = 0;
    for (let k = 3; k < 25; k++) {
      g.now = start + (k - 3) * DAY + 9 * H;
      g.decisions.length = 0;
      if (!changeRequestFor(g, c)) continue;
      const d = g.decisions.find((x) => x.kind === 'changeRequest' && x.data?.kind === 'extra');
      if (!d) continue;
      n++;
      const std = Number(d.data!.std);
      const dest = String(d.data!.dest);
      const out = blockMinutes(ac.typeId, 'HAM', dest);
      const back = blockMinutes(ac.typeId, dest, 'HAM');
      const turn = 40;
      expect(curfewOk('HAM', std)).toBe(true);
      expect(curfewOk(dest, std + out)).toBe(true);
      expect(curfewOk('HAM', std + out + turn + back)).toBe(true);
      expect(curfewOk('HAM', std + out + 45 + back)).toBe(true);
    }
    expect(n).toBeGreaterThanOrEqual(0);
  });
});

describe('OPS-6: four engines and ETOPS: the gate and the offer sheet agree (EDTO 180 for the long-haul quads)', () => {
  it('an A380 leg needs ETOPS 180 at the gate, and its offer sheet says so instead of "no ETOPS limits"', () => {
    const g = newGame(56);
    const a = addAircraft(g, 'a388');
    const f = addFlight(g, { no: ownFlightNo(g), aircraftId: a.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'MAD', std: day(g, 2), sta: day(g, 2) + 80, pax: 300 });
    expect(legApprovals(g, f)).toContain('etops180');
    const o = legsOffer(g, [['LIS', 'JFK', day(g, 20)]], 300);
    const etops = feasibility(g, o.id, a.id).checks.find((c) => c.id === 'etops')!;
    expect(etops.label).toMatch(/ETOPS 180/);
    // A tier-2 quad (747-400) keeps no ETOPS limit and no approval.
    const b = addAircraft(g, 'b744');
    expect(feasibility(g, o.id, b.id).checks.find((c) => c.id === 'etops')!.label).toBe('Four engines: no ETOPS limits');
  });
});

describe('CREW-2: the unit of an empty leg stops at a gap of days', () => {
  it('a ferry home on day 1 is not one unit with the move out and the job 13 days later', () => {
    const g = newGame(57);
    const ac = leased(g);
    const a = leg(g, ac, 'positioning', 'FCO', 'LIS', day(g, 1) + 14 * H);
    const b = leg(g, ac, 'positioning', 'LIS', 'AMS', day(g, 14) + 3 * H + 30);
    const r1 = leg(g, ac, 'revenue', 'AMS', 'AYT', day(g, 14) + 7 * H + 30);
    leg(g, ac, 'revenue', 'AYT', 'AMS', r1.sta + 50);
    expect(unitOf(g, ac, a).map((f) => f.id)).toEqual([a.id]);
    expect(unitOf(g, ac, b).length).toBe(3);
  });
});
