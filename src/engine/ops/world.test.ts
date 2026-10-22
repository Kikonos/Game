// v0.8 invented world events (UPDATE-0.8.md §5, §14): zones and great circles, closures (held legs, reroutes, the
// airspace decision, force majeure), war-risk cover, the uninsurable decision, how often events come.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { TPL_BY_ID } from '../../data/worldEvents';
import { ZONE_BY_ID } from '../../data/worldZones';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer } from '../contracts';
import { warRiskCost } from '../contracts/missionChecks';
import { hamBase, leased, legsOffer, newGame, owned } from '../contracts/testkit';
import { resolveDecision } from './events';
import { crosses, dailyWorld, flightZone, isLive, onWorldEnd, payWarRisk, startEvent, warRiskAt, worldEvent, worldEventPins, worldEvents, worldZones } from './world';

const iraq = ZONE_BY_ID.iraq;

/** A signed trip of these legs on this aircraft (ETOPS held so routing never blocks it); its revenue flights. */
function trip(g: GameState, acId: string, legs: [string, string, number][]) {
  if (!g.company.approvals.includes('etops120')) g.company.approvals.push('etops120');
  const o = legsOffer(g, legs, 150);
  const r = acceptOffer(g, o.id, [acId]);
  if (!r.ok) throw new Error(r.error);
  const c = g.contracts[r.data!.contractId];
  return { c, fl: Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std) };
}

describe('zones (§5.1)', () => {
  it('great circles: LIS–DXB crosses Iraq, LIS–JFK does not; IST–DXB does', () => {
    expect(crosses(iraq, 'LIS', 'DXB')).toBe(true);
    expect(crosses(iraq, 'LIS', 'JFK')).toBe(false);
    expect(crosses(iraq, 'IST', 'DXB')).toBe(true);
    expect(crosses(iraq, 'LIS', 'FAO')).toBe(false);
  });
});

describe('closures (§5.4)', () => {
  it('holds legs into the zone, reroutes overflights once by the detour, asks Wait or Cancel; Wait retimes to the reopening + 3 h', () => {
    const g = newGame(31);
    const t = g.now + 3 * DAY;
    const over = trip(g, owned(g).id, [['IST', 'DXB', t], ['DXB', 'IST', t + 6 * 60]]);
    const into = trip(g, leased(g).id, [['AMM', 'BGW', t + DAY], ['BGW', 'AMM', t + DAY + 3 * 60]]);
    const sta0 = over.fl[0].sta;
    const e = startEvent(g, { ...TPL_BY_ID.airspaceIraq, closeP: 1 });
    expect(e.closed).toBe(true);
    // Overflight: +detour once (a second pass changes nothing).
    expect(over.fl[0].detour).toBe(iraq.detourMin);
    expect(over.fl[0].sta).toBe(sta0 + iraq.detourMin);
    dailyWorld(g);
    expect(over.fl[0].sta).toBe(sta0 + iraq.detourMin);
    expect(flightZone(g, over.fl[0].id)?.effect).toBe('detour');
    // Held: both legs touch Baghdad.
    for (const f of into.fl) expect(f.closedBy).toBe(e.id);
    expect(flightZone(g, into.fl[0].id)?.effect).toBe('held');
    const d = g.decisions.find((x) => x.kind === 'airspace');
    expect(d).toBeDefined();
    expect(d!.defaultOption).toBe('wait');
    const rel0 = g.clients[into.c.clientId].relation;
    const r = resolveDecision(g, d!.id, 'wait');
    expect(r.ok).toBe(true);
    expect(into.fl[0].std).toBe(e.end + 3 * 60);
    expect(into.fl[1].std).toBeGreaterThan(into.fl[0].std);
    expect(g.clients[into.c.clientId].relation).toBe(rel0);
    // Views for the UI and map.
    expect(worldEvent(g, e.id)?.active).toBe(true);
    expect(worldEvents(g, { active: true }).map((x) => x.id)).toContain(e.id);
    expect(worldZones(g).some((z) => z.eventId === e.id && z.style === 'closed')).toBe(true);
    expect(worldZones(g)).toBe(worldZones(g));
    expect(worldEventPins(g).some((p) => p.eventId === e.id)).toBe(true);
  });

  it('an extension re-retimes the waiting legs to the new reopening', () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = newGame(seed);
      const t = g.now + 2 * DAY;
      const into = trip(g, leased(g).id, [['AMM', 'BGW', t], ['BGW', 'AMM', t + 3 * 60]]);
      const e = startEvent(g, { ...TPL_BY_ID.airspaceIraq, closeP: 1 });
      const d = g.decisions.find((x) => x.kind === 'airspace')!;
      resolveDecision(g, d.id, 'wait');
      g.now = e.end;
      onWorldEnd(g, { t: g.now, seq: 0, type: 'world.end', id: e.id, v: e.ev ?? 0 });
      if (!e.extended) {
        expect(e.done).toBe(true);
        continue;
      }
      expect(isLive(g, e)).toBe(true);
      expect(into.fl[0].std).toBe(e.end + 3 * 60);
      return;
    }
    throw new Error('no extension in 40 seeds (30 % each)');
  });

  it('Cancel is force majeure: no compensation, minutes off the month, no relation or reliability change', () => {
    const g = newGame(32);
    const t = g.now + 3 * DAY;
    const into = trip(g, leased(g).id, [['AMM', 'BGW', t], ['BGW', 'AMM', t + 3 * 60]]);
    startEvent(g, { ...TPL_BY_ID.airspaceIraq, closeP: 1 });
    const d = g.decisions.find((x) => x.kind === 'airspace')!;
    const rel0 = g.clients[into.c.clientId].relation;
    const rep0 = { ...g.company.reputation };
    const pen0 = g.finance.current.lines.penalties ?? 0;
    expect(resolveDecision(g, d.id, 'cancel').ok).toBe(true);
    for (const f of into.fl) expect(f.status).toBe('cancelled');
    expect(g.clients[into.c.clientId].relation).toBe(rel0);
    expect(g.company.reputation.reliable).toBe(rep0.reliable);
    expect(g.finance.current.lines.penalties ?? 0).toBe(pen0);
    expect(g.stats.v08?.legsFm).toBe(2);
  });

  it('a base programme just drops the closed waves (force majeure), with one message', () => {
    const g = newGame(3);
    const o = hamBase(g, g.now + 20 * DAY, 40);
    const r = acceptOffer(g, o.id, [owned(g).id]);
    expect(r.ok).toBe(true);
    const first = Object.values(g.flights).filter((f) => f.contractId === (r.ok ? r.data!.contractId : '') && f.kind === 'revenue').sort((a, b) => a.std - b.std)[0];
    g.now = first.std - 6 * 60;
    const m0 = g.messages.length;
    // A national strike closing Hamburg for a day or two (an invented airport closure at the base).
    const e = startEvent(g, { ...TPL_BY_ID.airspaceIraq, id: 'hamClosed', kind: 'strike', at: 'HAM', country: 'DE', zoneId: undefined, closeP: 0, airportDays: [2, 2], title: 'Strike closes Hamburg', body: '' });
    const dropped = Object.values(g.flights).filter((f) => f.closedBy === e.id && f.status === 'cancelled');
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((f) => f.std < (e.airportClosedUntil ?? 0))).toBe(true);
    expect(g.decisions.some((x) => x.kind === 'airspace')).toBe(false);
    expect(g.messages.slice(0, g.messages.length - m0).some((m) => /dropped: Strike closes Hamburg/.test(m.title))).toBe(true);
  });
});

describe('war-risk cover (§5.4)', () => {
  it('costs per landing by level, widebody × 1.8; a wet client is re-billed', () => {
    expect(warRiskCost(1, false)).toBe(8_000);
    expect(warRiskCost(3, false)).toBe(45_000);
    expect(warRiskCost(2, true)).toBe(Math.round(20_000 * BAL.v08.world.warRisk.wideMult));
    const g = newGame(3);
    expect(warRiskAt(g, 'SAH')).toBe(3);
    expect(warRiskAt(g, 'LIS')).toBe(0);
    const o = hamBase(g, g.now + 20 * DAY, 40);
    const r = acceptOffer(g, o.id, [owned(g).id]);
    if (!r.ok) throw new Error(r.error);
    const f = Object.values(g.flights).find((x) => x.contractId === r.data!.contractId && x.kind === 'revenue')!;
    f.to = 'SAH';
    const ledger0 = g.finance.current.lines.warRisk ?? 0;
    const recv0 = g.finance.receivables.length;
    payWarRisk(g, f);
    expect((g.finance.current.lines.warRisk ?? 0) - ledger0).toBe(-45_000);
    expect(f.warRisk).toBe(45_000);
    expect(g.finance.receivables.length).toBe(recv0 + 1);
    expect(g.finance.receivables[g.finance.receivables.length - 1].amount).toBe(45_000);
  });
});

describe('uninsurable (§5.4)', () => {
  it('about 10 % of legs into level-3 war risk lose cover 24–48 h out: Wait moves them a day, Cancel is force majeure', () => {
    let asked = 0;
    let legs = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGame(seed);
      const t = g.now + 36 * 60;
      const { fl } = trip(g, owned(g).id, [['JED', 'ADE', t], ['ADE', 'JED', t + 4 * 60]]);
      legs++;
      dailyWorld(g);
      const d = g.decisions.find((x) => x.kind === 'uninsurable');
      if (!d) {
        expect(fl[0].uninsured).toBe('ok');
        continue;
      }
      asked++;
      expect(d.defaultOption).toBe('cancel');
      if (asked === 1) {
        const std = fl[0].std;
        expect(resolveDecision(g, d.id, 'wait').ok).toBe(true);
        expect(fl[0].std).toBe(std + DAY);
        expect(fl[0].uninsured).toBe('wait');
      } else {
        const rel0 = g.clients[g.contracts[fl[0].contractId!].clientId].relation;
        expect(resolveDecision(g, d.id, 'cancel').ok).toBe(true);
        expect(fl.every((f) => f.status === 'cancelled')).toBe(true);
        expect(g.clients[g.contracts[fl[0].contractId!].clientId].relation).toBe(rel0);
      }
    }
    expect(asked).toBeGreaterThanOrEqual(2);
    expect(asked / legs).toBeLessThan(0.25);
  });
});

describe('generation (§5.2)', () => {
  it('1.5–3 events a month over 3 years, never more than 3 live, never closing our home country', () => {
    for (const seed of [41, 42]) {
      const g = newGame(seed);
      const home = AIRPORT_BY_CODE[g.company.homeBase].country;
      const days = 3 * 365;
      for (let i = 0; i < days; i++) {
        g.now += DAY;
        dailyWorld(g);
        const live = (g.world?.events ?? []).filter((e) => isLive(g, e));
        expect(live.length).toBeLessThanOrEqual(3);
        for (const e of live) {
          if (e.closed && e.zoneId) expect(ZONE_BY_ID[e.zoneId].countries).not.toContain(home);
          if (e.airportClosedUntil) expect(e.at).not.toBe(g.company.homeBase);
        }
      }
      const n = g.stats.v08?.worldEvents ?? 0;
      const perMonth = n / (days / 30.44);
      expect(perMonth).toBeGreaterThanOrEqual(1.5);
      expect(perMonth).toBeLessThanOrEqual(3);
    }
  });
});
