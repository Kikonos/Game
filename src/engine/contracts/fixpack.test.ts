// v0.8 fix pack sweep (items 1 and 3): over seeds, dates and company states, every generator (v0.7 and v0.8 kinds)
// builds offers whose seats are the passengers (stretchers the only extra), and whose every duty day a crew may fly on
// its own reference type (fuel stops included): never 'longer than any crew may fly'.

import { describe, expect, it } from 'vitest';
import { nextHajj } from '../../data/worldCalendar';
import { DAY, fromUTC } from '../core/time';
import type { ApprovalId, Archetype, ContractOffer, GameState } from '../core/types';
import { dutyNeed } from '../crew/duties';
import { bestSlip } from '../crew/slip';
import { crewChains, ULR_REST } from './feasibility';
import { crewCanFly, generateOffer, maxPax, newcomerNarrow } from './offers';
import { programmeOf } from './plan';
import { isWideJob, referenceType } from './pricing';
import { addAircraft, newGame } from './testkit';
import { breathe } from '../../test/breathe';

const KINDS: Archetype[] = [
  'seasonBase', 'aogCover', 'adhoc', 'sports', 'repatriation', 'tourSeries', 'troopRotation', 'vip',
  'hajj', 'unRotation', 'deportation', 'evacuation', 'medical', 'humanitarian', 'musicTour', 'antarctic', 'capacityLease', 'subcharterIn',
];
const RELIEF = ['PAP', 'KTM', 'DAC', 'ADD', 'NBO', 'FIH'];

type State = 'newcomer' | 'established' | 'respected';

function setUp(seed: number, state: State, month: number): GameState {
  const g = newGame(seed, seed % 2 ? 'LIS' : 'DUB', state === 'newcomer');
  g.now = fromUTC(2027, month, 3 + seed);
  if (state === 'respected') {
    g.company.standing = 2;
    const all: ApprovalId[] = ['widebody', 'augmented', 'etops120', 'etops180', 'etops240', 'ulr', 'iosa', 'polar', 'dg'];
    for (const a of all) if (!g.company.approvals.includes(a)) g.company.approvals.push(a);
    addAircraft(g, 'a333');
    addAircraft(g, 'b744');
  }
  return g;
}

function sectorsOf(o: ContractOffer): [string, string][] {
  const p = o.pattern;
  return p.kind === 'base' ? p.dests.flatMap((d) => [[p.base, d], [d, p.base]] as [string, string][]) : p.legs.map((l) => [l.from, l.to]);
}

function build(g: GameState, kind: Archetype, i: number): ContractOffer | null {
  const wide = i % 2 === 1;
  if (kind === 'hajj') {
    const h = nextHajj(g.now, 2).find((x) => x.arafah - 120 * DAY > g.now) ?? nextHajj(g.now, 2)[1];
    const save = g.now;
    g.now = h.arafah - 120 * DAY;
    const o = generateOffer(g, 'hajj', { wide, window: false });
    g.now = save;
    return o;
  }
  if (kind === 'humanitarian') return generateOffer(g, kind, { wide, window: false, airport: RELIEF[i % RELIEF.length] });
  if (kind === 'subcharterIn') {
    const r = g.rivals.find((x) => x.clientId);
    const end = Object.values(g.clients).find((c) => c.kind === 'airline' && !c.rivalId && c.base !== r?.base);
    if (!r || !end) return null;
    return generateOffer(g, kind, { wide, window: false, rival: r.id, endClient: end.id, client: r.clientId });
  }
  return generateOffer(g, kind, { wide, window: false });
}

describe('v0.8 fix pack: seats = passengers, no impossible days (sweep)', () => {
  it('every generated offer over seeds, dates and company states: pax ≤ seats = most pax (+6 a stretcher); every day flyable on its reference type', { timeout: 240_000 }, async () => {
    let n = 0;
    let legsJobs = 0;
    const seen = new Set<Archetype>();
    for (let seed = 1; seed <= 6; seed++) {
      for (const state of ['newcomer', 'established', 'respected'] as State[]) {
        for (const month of [2, 6, 10]) {
          const g = setUp(seed, state, month);
          await breathe();
          for (const kind of KINDS) {
            for (let i = 0; i < 2; i++) {
              const o = build(g, kind, i + seed);
              if (!o) continue;
              n++;
              seen.add(o.archetype);
              const req = o.requirements;
              const where = `${o.archetype} "${o.title}" seed ${seed} ${state} m${month}`;
              // 1. Seats = passengers.
              if (o.pattern.kind === 'legs' && o.pattern.legs.length) {
                legsJobs++;
                const pax = maxPax(o.pattern);
                expect(pax, where).toBeGreaterThan(0);
                for (const l of o.pattern.legs) expect(l.pax ?? 0, where).toBeLessThanOrEqual(req.minSeats);
                expect(req.minSeats, where).toBe(pax + 6 * (req.stretchers ?? 0));
              }
              // 3. Every chain on the reference type within what a crew may fly (bunks, 4 pilots at best).
              const ref = referenceType(req, sectorsOf(o), o.pattern.kind === 'base', req.approvals.includes('ulr'));
              expect(ref, where).toBeTruthy();
              const prog = programmeOf(o, ref!);
              expect(prog.ok, where).toBe(true);
              expect(crewCanFly(g, ref!, prog.chains), where).toBe(true);
              const gx = { ...g, company: { ...g.company, approvals: [...g.company.approvals, 'augmented' as ApprovalId] } };
              // (v0.9 §W: or a crew change at one fuel stop makes it flyable, priced into the offer.)
              for (const c of crewChains(g, prog.chains)) if (!bestSlip(gx, ref!, ULR_REST, c)) expect(dutyNeed(gx, ref!, ULR_REST, c).text, where).not.toMatch(/longer than any crew may fly/);
              // Done with it: one open request per client and kind would block the next.
              delete g.offers[o.id];
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(400);
    expect(legsJobs).toBeGreaterThan(250);
    for (const k of KINDS) expect(seen.has(k), k).toBe(true);
  });

  it('the screenshot cases: a Dili consular airlift and a Madrid–Singapore tour never come with a day no crew may fly', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = setUp(seed, 'respected', 10);
      const dil = generateOffer(g, 'repatriation', { wide: true, window: false, airport: 'DIL' });
      if (dil) {
        const p = dil.pattern;
        expect(p.kind).toBe('legs');
        const legs = p.kind === 'legs' ? p.legs : [];
        const ref = referenceType(dil.requirements, sectorsOf(dil))!;
        expect(crewCanFly(g, ref, programmeOf(dil, ref).chains)).toBe(true);
        // One aircraft can fly them all: home, back empty and turned before the next one.
        for (let i = 1; i < legs.length; i++) expect(legs[i].dep - legs[i - 1].dep).toBeGreaterThanOrEqual(2 * 60 * 2);
      }
      const sin = generateOffer(g, 'sports', { wide: true, window: false, airport: 'SIN' });
      if (sin) {
        const ref = referenceType(sin.requirements, sectorsOf(sin), false, sin.requirements.approvals.includes('ulr'))!;
        expect(crewCanFly(g, ref, programmeOf(sin, ref).chains)).toBe(true);
      }
    }
  });

  it('newcomer noise: a Newcomer without a widebody sees far fewer jobs it can never fly (widebody, medical without DG) than one with Widebody operations', () => {
    const count = (approve: boolean) => {
      let wide = 0;
      let total = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const g = setUp(seed, 'newcomer', 3);
        if (approve) g.company.approvals.push('widebody');
        expect(newcomerNarrow(g)).toBe(!approve);
        for (let i = 0; i < 60; i++) {
          const o = generateOffer(g);
          if (!o) continue;
          total++;
          // Work it can never fly: a widebody job, or a medical airbridge (dangerous-goods approval).
          if (isWideJob(o.requirements) || o.archetype === 'medical') wide++;
          delete g.offers[o.id];
        }
      }
      return wide / Math.max(1, total);
    };
    const narrow = count(false);
    const open = count(true);
    expect(narrow).toBeLessThan(0.08);
    expect(narrow).toBeLessThan(open);
  });
});
