// v0.7 delivery (UPDATE-0.7.md §F6.4): handover abroad, delivery pilots on airline deadheads, the ferry home in
// ferry days with night stops, never cancelled for want of pilots.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { reportMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { legsOffer, newGame, run } from '../contracts/testkit';
import { acceptOffer } from '../contracts';
import { flightsOf, removeFlights } from '../core/entities';
import { crewCalendar } from '../crew';
import { addCrew } from '../crew/fixtures';
import { devGrantApproval } from './company';
import { commercialItinerary } from './commercial';
import { deliveryQuote, deliveryStatus, ferryDays, ferryRoute, firstFerryDep, ticketPurpose } from './delivery';
import { acquireAircraft, devMarketOffer } from './market';

/** Each ferry day (legs between night stops): ≤ 3 sectors, ≤ 10:00 of block plus turns. */
function days(legs: { std: number; sta: number; nightStopAfter: boolean }[]) {
  const out: (typeof legs)[] = [[]];
  for (const l of legs) {
    out[out.length - 1].push(l);
    if (l.nightStopAfter) out.push([]);
  }
  return out.filter((d) => d.length);
}

function signed(g: GameState, typeId: string, site: string): string {
  g.company.cash = 60_000_000;
  const id = devMarketOffer(g, typeId, { site });
  const r = acquireAircraft(g, id);
  if (!r.ok) throw new Error(r.error);
  return r.data!.aircraftId;
}

describe('delivery ferry planning', () => {
  it('SCL→LIS on a 767 takes 2+ legs; CGK→LIS on an A320 takes several days with night stops; every ferry day is legal for two pilots', () => {
    const g = newGame(1);
    const scl = deliveryQuote(g, 'b763', 'SCL', g.now + 10 * DAY);
    expect(scl.legs.length).toBeGreaterThanOrEqual(2);
    expect(scl.legs[0].from).toBe('SCL');
    expect(scl.legs[scl.legs.length - 1].to).toBe('LIS');
    const cgk = deliveryQuote(g, 'a320ceo', 'CGK', g.now + 10 * DAY);
    expect(cgk.days).toBeGreaterThanOrEqual(2);
    for (const q of [scl, cgk, deliveryQuote(g, 'a388', 'KUL', g.now), deliveryQuote(g, 'b772', 'BOM', g.now), deliveryQuote(g, 'a35u', 'SIN', g.now), deliveryQuote(g, 'b789', 'CHS', g.now)]) {
      expect(q.legs.length, q.site).toBeGreaterThan(0);
      for (const d of days(q.legs)) {
        expect(d.length).toBeLessThanOrEqual(BAL.delivery.daySectorsMax);
        expect(d[d.length - 1].sta - d[0].std).toBeLessThanOrEqual(BAL.delivery.dayBlockMax);
      }
      // A night stop gives the pilots their rest away from base: release to next report at least the day's duty
      // and never under the night stop (seed 6: SCL–DSS–LIS was planned 5 minutes short, the ferry waited a month).
      const rm = reportMinutes(q === scl ? 'b763' : q === cgk ? 'a320ceo' : 'b772');
      let day0 = q.legs[0].std;
      for (let i = 1; i < q.legs.length; i++) {
        const gap = q.legs[i].std - q.legs[i - 1].sta;
        if (q.legs[i - 1].nightStopAfter) {
          expect(gap).toBeGreaterThanOrEqual(BAL.delivery.nightStop);
          const release = q.legs[i - 1].sta + rm.post;
          expect(q.legs[i].std - rm.report - release, q.site).toBeGreaterThanOrEqual(Math.max(BAL.delivery.nightStop, release - (day0 - rm.report)));
          day0 = q.legs[i].std;
        } else expect(gap).toBe(BAL.delivery.fuelStopTurn);
        expect(q.legs[i].from).toBe(q.legs[i - 1].to);
      }
      expect(q.total).toBe(q.fuel + q.fees + q.crew);
      // v0.11 '· the 60-minute way' when the usual way needs more ETOPS than we may fly.
      expect(q.text).toMatch(/^[A-Z]{3}(–[A-Z]{3})+ · \d+ legs? (· \d+ night stops? )?(· (the 60-minute way|within ETOPS \d+) )?· ≈ \$/);
    }
    // First departure: acceptance after the handover, then 08:00 local at the site.
    const h = g.now + 3 * DAY + 5 * 60;
    const dep = firstFerryDep('SCL', h);
    expect(dep).toBeGreaterThanOrEqual(h + 36 * 60);
    expect(dep - h).toBeLessThan(36 * 60 + DAY);
    // No ferry from home; the router is pure and cached.
    expect(deliveryQuote(g, 'a320ceo', 'LIS', g.now).legs).toEqual([]);
    expect(ferryRoute('a320ceo', 'CGK', 'LIS')).toBe(ferryRoute('a320ceo', 'CGK', 'LIS'));
    expect(ferryDays([], g.now)).toEqual([]);
  });
});

describe('a delivery from signing to home', () => {
  it('rated pilots deadhead out on airline flights, rest, ferry home over two days with zero illegal duties; handover then home message; fuel and fees charged', () => {
    const g = newGame(7);
    devGrantApproval(g, 'widebody');
    addCrew(g, { CPT: 4, FO: 4 }, 'A330/340');
    const acId = signed(g, 'a332', 'SCL');
    const ac = g.fleet[acId];
    const legs = ac.delivery!.ferryIds.map((id) => g.flights[id]);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    run(g, ac.deliveredAt - DAY);
    const pre = deliveryStatus(g, acId)!;
    expect(pre.phase).toBe('preparing');
    expect(pre.pilotIds.length).toBe(2);
    for (const id of pre.pilotIds) expect(g.crew[id].ratings).toContain('A330/340');
    expect(pre.ticketIds.length).toBeGreaterThan(0);
    for (const t of pre.ticketIds) {
      expect(ticketPurpose(g, t)).toMatchObject({ kind: 'delivery', aircraftId: acId });
      expect(commercialItinerary(g, g.flights[t]).length).toBeGreaterThan(0);
      expect(g.flights[t].to).toBe('SCL');
    }
    // Their calendars show the deadhead and the ferry duties.
    const cal = crewCalendar(g, pre.pilotIds[0], g.now - DAY, g.now + 10 * DAY);
    expect(cal.some((b) => b.kind === 'deadhead' || b.kind === 'positioning')).toBe(true);
    expect(cal.filter((b) => b.kind === 'duty').length).toBeGreaterThanOrEqual(1);
    const fuel0 = g.finance.current.lines.fuel ?? 0;
    run(g, ac.deliveredAt + 60);
    expect(ac).toMatchObject({ status: 'available', at: 'SCL' });
    expect(g.messages.some((m) => m.title === `${ac.reg} handed over at Santiago` && /Captain .* and FO /.test(m.body))).toBe(true);
    expect(deliveryStatus(g, acId)!.phase).toBe('handedOver');
    run(g, ac.deliveredAt + 6 * DAY);
    expect(ac.at).toBe('LIS');
    expect(ac.delivery!.arrived).toBeDefined();
    expect(deliveryStatus(g, acId)!.phase).toBe('home');
    const home = g.messages.find((m) => m.title === `${ac.reg} is home`)!;
    expect(home.body).toMatch(/^Delivered to Lisbon after \d days? of ferry flying \(\$.* fuel and fees, crew costs \$.*\)\.$/);
    expect(g.stats.illegalCrewFlown ?? 0).toBe(0);
    expect(g.stats.illegalFlown ?? 0).toBe(0);
    expect(legs.every((f) => f.status === 'done')).toBe(true);
    const spent = [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines.fuel ?? 0), 0);
    expect(spent).toBeLessThan(fuel0);
  });

  it('without rated pilots it is never cancelled: one 48 h warning, a daily retime, parking posted; rated pilots end the wait', () => {
    const g = newGame(8);
    devGrantApproval(g, 'widebody');
    const acId = signed(g, 'b763', 'FRA');
    const ac = g.fleet[acId];
    const f = g.flights[ac.delivery!.ferryIds[0]];
    const std0 = f.std;
    run(g, std0 + 3 * DAY + 60);
    expect(f.status).toBe('scheduled');
    expect(f.std).toBe(std0 + 4 * DAY);
    expect(deliveryStatus(g, acId)!.phase).toBe('waiting');
    expect(ac.delivery!.waitingSince).toBeDefined();
    expect(g.messages.filter((m) => m.title === `Delivery ferry ${ac.reg} has no rated pilots`)).toHaveLength(1);
    const fees = [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines.airportFees ?? 0), 0);
    expect(fees).toBeLessThanOrEqual(-3 * BAL.delivery.parkPerDay[1]);
    // Rated pilots: the ferry flies (at the next daily try) and the wait is counted.
    // (v0.9: hired in for it, nothing planned yet: no day off in the way.)
    for (const id of addCrew(g, { CPT: 2, FO: 2 }, 'B757/767')) g.crew[id].off = [];
    run(g, f.std + 2 * DAY);
    expect(f.status).toBe('done');
    expect(ac.delivery!.waitingSince).toBeUndefined();
    expect(g.stats.deliveryWaitDays).toBeGreaterThanOrEqual(3);
    expect(ac.at).toBe('LIS');
  });

  it('work signed behind a ferry with no rated pilots moves behind it (or is dropped); the ferry itself is never cancelled', () => {
    const g = newGame(5);
    const acId = signed(g, 'b738', 'OSL');
    const ac = g.fleet[acId];
    const homeBy = deliveryStatus(g, acId)!.homeBy!;
    const o = legsOffer(g, [['LIS', 'FAO', homeBy + 8 * 60], ['FAO', 'LIS', homeBy + 11 * 60]], 150);
    expect(acceptOffer(g, o.id, [acId]).ok).toBe(true);
    run(g, homeBy + 5 * DAY);
    const ferry = ac.delivery!.ferryIds.map((id) => g.flights[id]);
    expect(ferry.length).toBeGreaterThan(0);
    for (const f of ferry) expect(f.status).not.toBe('cancelled');
    const live = flightsOf(g, acId).filter((f) => f.status === 'scheduled' || f.status === 'enroute');
    for (let i = 1; i < live.length; i++) expect(live[i].std).toBeGreaterThanOrEqual(live[i - 1].sta);
    expect(deliveryStatus(g, acId)!.phase).toBe('waiting');
    // The 48 h warning already names the contract work behind the ferry.
    expect(g.messages.find((m) => m.title === `Delivery ferry ${ac.reg} has no rated pilots`)?.body).toMatch(/Contract work from .* waits behind the ferry/);
  });

  it('a delivery whose ferry legs are gone is re-planned from where the aircraft is', () => {
    const g = newGame(6);
    const acId = signed(g, 'a320ceo', 'SNN');
    const ac = g.fleet[acId];
    run(g, ac.deliveredAt + 60);
    removeFlights(g, [...ac.delivery!.ferryIds]);
    run(g, g.now + 2 * DAY);
    const fs = ac.delivery!.ferryIds.map((id) => g.flights[id]).filter(Boolean);
    expect(fs.length).toBeGreaterThan(0);
    expect(fs[0]).toMatchObject({ purpose: 'delivery', from: 'SNN' });
    expect(g.messages.some((m) => m.title === `Delivery ferry re-planned: ${ac.reg}`)).toBe(true);
  });
});
