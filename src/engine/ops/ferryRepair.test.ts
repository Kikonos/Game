// v0.23.2 hotfix (player report, save "Malteser", 27 Jul 2027 21:24 UTC): 9H-VZH (A320) flew Santiago–Quito on 25 Jul on
// its way to Titan Airways' London job (Virgin Atlantic's overflow, LHR–MXP / LHR–FRA from 26 Jul). Its two ferry pilots
// were at Quito, rested from 26 Jul 07:33. The onward leg MTL130 UIO–BDL stood at 29 Jul 13:55 and the last one ended at
// Frankfurt on 31 Jul; seven London flights were cancelled ($15K each) and more went every day. Played on with v0.23.1
// the aircraft never left: each time a London flight was cancelled the move was planned again and its first leg put a
// crew ticket's lead from now (46 h at Quito), 20 flights gone by 2 Aug.
// Pinned: the move leaves as soon as its crew can fly it and the aircraft is in London on 29 Jul; on load the flights
// it cannot reach are taken off at no charge, the others go back to their times, and the $105K is given back once.

import { describe, expect, it } from 'vitest';
import type { Flight, GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { resolveDecision } from './index';
import { stuckFerries } from './ferryRepair';

const H = 60;
const DAY = 24 * H;
/** The save's clock: 27 Jul 2027 21:24 UTC. */
const NOW = 14500644;
/** 30 Jul 2027 05:00 UTC, the first London wave the aircraft can fly. */
const JUL30 = NOW - (21 * H + 24) + 3 * DAY + 5 * H;

const load = (): GameState => deserialize(fixture('v0231-vzh'));
/** The save with the one-off repair marked as done: the engine alone. */
const loadBare = (): GameState => {
  const file = JSON.parse(fixture('v0231-vzh')) as { state: GameState };
  file.state.stats.ferryRefund = 0;
  return deserialize(JSON.stringify(file));
};
const play = (g: GameState, until: number): void => {
  while (g.now < until) {
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    advanceTo(g, Math.min(until, g.now + 30));
  }
};
const jobLegs = (g: GameState): Flight[] => Object.values(g.flights).filter((f) => f.contractId === 'kax7' && f.kind === 'revenue');
const cancelled = (g: GameState): Flight[] => jobLegs(g).filter((f) => f.status === 'cancelled');
const refunds = (g: GameState) => g.messages.filter((m) => /^Refund: 9H-VZH stuck at Quito/.test(m.title));
const mtl130 = (g: GameState) => g.flights.f1hq;

describe('9H-VZH stuck at Quito: the repair and the refund on load', () => {
  it('the ferry leaves that night, the lost flights are refunded once, the unreachable ones taken off free', () => {
    const raw = (JSON.parse(fixture('v0231-vzh')) as { state: GameState }).state;
    expect(raw.company.cash).toBe(1838522);
    expect(raw.flights.f1hq.std).toBe(NOW + 40 * H + 31);
    const g = load();
    expect(g.now).toBe(NOW);
    // The refund: seven flights at $15K, on the ledger's refund line, one message.
    expect(g.stats.ferryRefund).toBe(105000);
    expect(g.company.cash).toBe(1838522 + 105000);
    expect(g.finance.current.lines.refund).toBe(105000);
    expect(refunds(g)).toHaveLength(1);
    expect(refunds(g)[0].body).toMatch(/compensation \$105K for 7 flights/);
    expect(refunds(g)[0].body).toMatch(/9 flights it cannot reach were taken off at no charge/);
    expect(refunds(g)[0].body).toMatch(/lands in London 29 Jul/);
    // The ferry: Quito–Hartford when the captain's rest after her hotel standby ends (28 Jul 03:10), not on 29 Jul.
    expect(mtl130(g).status).toBe('scheduled');
    expect(mtl130(g).std).toBe(NOW + 5 * H + 46);
    expect(mtl130(g).crewIds).toHaveLength(2);
    // The flights of 27 to 29 Jul it cannot reach are gone, at no charge; nothing later is.
    expect(cancelled(g)).toHaveLength(16);
    expect(cancelled(g).every((f) => (f.schedStd ?? f.std) < JUL30)).toBe(true);
    expect(g.finance.current.lines.penalties).toBe(raw.finance.current.lines.penalties);
    // The flights pushed late are back at their own times: London–Milan on 30 Jul at 05:00.
    const later = jobLegs(g).filter((f) => f.status === 'scheduled');
    expect(later.length).toBeGreaterThan(40);
    expect(later.every((f) => f.schedStd === undefined || f.schedStd === f.std)).toBe(true);
    expect(later.some((f) => f.no === 'VS7000' && f.std === JUL30)).toBe(true);
    // Nothing is stuck any more, and a save made now never runs the repair again.
    const again = deserialize(serialize(g));
    expect(again.company.cash).toBe(g.company.cash);
    expect(again.stats.ferryRefund).toBe(105000);
    expect(refunds(again)).toHaveLength(1);
    expect(cancelled(again)).toHaveLength(16);
    expect(mtl130(again).std).toBe(mtl130(g).std);
  }, 120_000);

  it('played on: in London on 29 Jul, the job flown from 30 Jul with no more flights lost', () => {
    const g = load();
    play(g, JUL30 + 8 * H);
    const ac = g.fleet.a1fg;
    const ferry = Object.values(g.flights).filter((f) => f.aircraftId === 'a1fg' && f.kind === 'positioning' && f.status === 'done' && f.std > NOW).sort((a, b) => a.std - b.std);
    expect(ferry.map((f) => `${f.from}-${f.to}`)).toEqual(['UIO-BDL', 'BDL-SFJ', 'SFJ-LHR']);
    // Landed in London on 29 Jul, before the evening.
    expect(ferry[2].ata!).toBeLessThan(JUL30 - 11 * H);
    expect(cancelled(g)).toHaveLength(16);
    const flown = jobLegs(g).filter((f) => f.status === 'done' && f.aircraftId === ac.id && !f.operatedBy);
    expect(flown.map((f) => `${f.no} ${f.from}-${f.to}`)).toEqual(['VS7000 LHR-MXP', 'VS7001 MXP-LHR']);
    expect(flown[0].atd! - JUL30).toBeLessThan(30);
    expect(refunds(g)).toHaveLength(1);
  }, 300_000);
});

describe('9H-VZH stuck at Quito: the engine alone (no repair)', () => {
  it('the save is read as stuck, with the seven flights it cost', () => {
    const g = loadBare();
    expect(g.stats.ferryRefund).toBe(0);
    expect(refunds(g)).toHaveLength(0);
    const s = stuckFerries(g);
    expect(s).toHaveLength(1);
    expect(s[0].ac.reg).toBe('9H-VZH');
    expect(s[0].at).toBe('UIO');
    expect(s[0].contract.id).toBe('kax7');
    expect(s[0].lost).toHaveLength(7);
    expect(s[0].money).toBe(105000);
  }, 60_000);

  it('the late ferry is pulled to when its crew at Quito can fly it, and is never put back again', () => {
    const g = loadBare();
    play(g, NOW + 30);
    // Planned again at the first settle: 28 Jul 03:10, its two pilots kept.
    expect(mtl130(g).std).toBe(NOW + 5 * H + 46);
    expect(mtl130(g).crewIds).toHaveLength(2);
    // On through the days that pushed it back before (a London flight given up each morning).
    play(g, JUL30 + 8 * H);
    expect(mtl130(g).status).toBe('done');
    expect(mtl130(g).atd!).toBeLessThan(NOW + 7 * H);
    const ac = g.fleet.a1fg;
    expect(['LHR', 'MXP', 'FRA']).toContain(ac.flightId ? g.flights[ac.flightId].to : ac.at);
    // No flight of the job stands days late in the night any more: each is flown near its time or given up.
    for (const f of jobLegs(g)) if (f.status === 'done' && f.atd !== undefined && f.atd > NOW) expect(f.atd - (f.schedStd ?? f.std)).toBeLessThanOrEqual(6 * H + 30);
  }, 300_000);
});
