// Aircraft market and lease lifecycle (B3). DESIGN.md §5.10. v0.7 (UPDATE-0.7.md §F6): daily roll, Ladder gate
// and teasers, new-build slots, handover sites, alerts.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { EX_OPERATORS, FACTORIES, LESSOR_SITES, MRO_STATIONS, NEW_BUILD } from '../../data/market';
import { BAL } from '../core/balance';
import { clearPause, takePause } from '../core/pause';
import { typeOf } from '../core/perf';
import { DAY, monthKey, monthStart } from '../core/time';
import type { GameState, SimEvent } from '../core/types';
import { leased, newGame } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { aircraftGate, devGrantApproval } from './company';
import { itinerary, ticketBlock } from './commercial';
import { acquireAircraft, addShock, dailyMarket, demandFactor, devMarketOffer, eligibleTypes, marketOutlook, marketView, onDelivery, onLeaseEnd, refreshMarket, returnSiteOf, segIndex, setPhase } from './market';

const REAL_LESSORS = ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group'];
const ev = (g: GameState, type: SimEvent['type'], id: string): SimEvent => ({ t: g.now, seq: 0, type, id, v: 0 });

/** The market's own handlers day by day (daily roll, monthly refresh) for `days`; every offer seen once. */
function market(seed: number, days: number, setup?: (g: GameState) => void) {
  const g = newGame(seed);
  setup?.(g);
  const seen = new Map<string, { day: number; o: GameState['market']['aircraft'][number] }>();
  let maxOpen = 0;
  const note = (day: number) => {
    for (const o of g.market.aircraft) if (!seen.has(o.id)) seen.set(o.id, { day, o: { ...o } });
    maxOpen = Math.max(maxOpen, g.market.aircraft.filter((o) => o.expires > g.now).length);
  };
  note(0);
  let k = monthKey(g.now);
  for (let d = 1; d <= days; d++) {
    g.now += DAY;
    if (monthKey(g.now) !== k) {
      k = monthKey(g.now);
      refreshMarket(g);
    }
    dailyMarket(g);
    note(d);
  }
  return { g, seen: [...seen.values()], maxOpen };
}

describe('market spawning (v0.7)', () => {
  it('about one offer a month (0.8–1.2 over 50 seeds × 2 years), at most 4 open, each open 7–21 days', () => {
    let n = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { seen, maxOpen } = market(seed, 730);
      n += seen.length;
      expect(maxOpen).toBeLessThanOrEqual(4);
      for (const { o } of seen) {
        const life = (o.expires - (o.created ?? 0)) / DAY;
        expect(life).toBeGreaterThanOrEqual(7);
        expect(life).toBeLessThanOrEqual(21);
        expect(REAL_LESSORS.some((l) => o.lessor.startsWith(l))).toBe(true);
      }
    }
    const perMonth = n / 50 / 24;
    expect(perMonth).toBeGreaterThanOrEqual(0.8);
    expect(perMonth).toBeLessThanOrEqual(1.2);
  });

  it('guarantees a narrowbody dry lease by month 2 and an old 767/A330 lease by month 6 (a teaser while the gate is closed)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { seen } = market(seed, 185);
      const narrow = seen.find((s) => s.day <= 62 && s.o.kind === 'dryLeaseIn' && (s.o.typeId === 'a320ceo' || s.o.typeId === 'b738'));
      const wide = seen.find((s) => s.day >= 85 && s.o.kind === 'dryLeaseIn' && (s.o.typeId === 'b763' || s.o.typeId === 'a332'));
      expect(narrow, `seed ${seed} narrowbody`).toBeTruthy();
      expect(wide, `seed ${seed} widebody`).toBeTruthy();
    }
  });

  it('teasers only one rung away, never two: types follow the Ladder', () => {
    const tiers = (g: GameState) => eligibleTypes(g).map((e) => [e.t.id, e.teaser] as const);
    const g = newGame(3);
    const start = tiers(g);
    expect(start.filter(([, t]) => !t).map(([id]) => typeOf(id).tier).every((x) => x <= 1)).toBe(true);
    expect(start.filter(([, t]) => t).map(([id]) => typeOf(id).tier).every((x) => x === 2)).toBe(true);
    for (let seed = 1; seed <= 20; seed++) for (const { o } of market(seed, 365).seen) expect(typeOf(o.typeId).tier, o.typeId).toBeLessThanOrEqual(2);
    // Widebody operations held: tier 2 normal, tier 3 hidden (two approvals missing), tier 4 hidden.
    devGrantApproval(g, 'widebody');
    const wb = tiers(g);
    expect(wb.filter(([id]) => typeOf(id).tier === 2).every(([, t]) => !t)).toBe(true);
    expect(wb.filter(([id]) => typeOf(id).tier >= 3).map(([id]) => id)).toEqual([]);
    devGrantApproval(g, 'augmented');
    expect(tiers(g).filter(([id]) => typeOf(id).tier === 3).every(([, t]) => t)).toBe(true);
    expect(tiers(g).some(([id]) => typeOf(id).tier === 4)).toBe(false);
  });

  it('new-build slots only for the new-build types, with a 180–420-day lead, 96–144-month leases, 3 months deposit, at the factory', () => {
    let nb = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { seen } = market(seed, 730, (g) => {
        devGrantApproval(g, 'widebody');
        devGrantApproval(g, 'augmented');
        devGrantApproval(g, 'etops180');
        devGrantApproval(g, 'etops240');
      });
      for (const { o } of seen) {
        if (!o.newBuild) continue;
        nb++;
        expect(NEW_BUILD).toContain(o.typeId);
        expect(o.leadDays).toBeGreaterThanOrEqual(180);
        expect(o.leadDays).toBeLessThanOrEqual(420);
        expect(o.leaseMonths).toBeGreaterThanOrEqual(96);
        expect(o.leaseMonths).toBeLessThanOrEqual(144);
        expect(o.deposit).toBe(3 * o.rentPerMonth);
        expect(FACTORIES[typeOf(o.typeId).family]!.sites.map((s) => s.code)).toContain(o.site);
      }
    }
    expect(nb).toBeGreaterThan(0);
    const g = newGame(2);
    const nbId = devMarketOffer(g, 'a321neo', { newBuild: true });
    const nbOffer = g.market.aircraft.find((o) => o.id === nbId)!;
    expect(nbOffer.newBuild).toBe(true);
    expect(nbOffer.where).toMatch(/^Airbus, (Hamburg|Toulouse) \((HAM|TLS)\)$/);
  });

  it('every handover site and MRO station exists and is reachable on airline tickets from Lisbon', () => {
    const codes = new Set<string>([...LESSOR_SITES.map((s) => s.code), ...MRO_STATIONS.map((s) => s.code)]);
    for (const ops of Object.values(EX_OPERATORS)) for (const x of ops) codes.add(x.hub);
    for (const f of Object.values(FACTORIES)) for (const s of f!.sites) codes.add(s.code);
    for (const c of codes) {
      expect(AIRPORT_BY_CODE[c], c).toBeTruthy();
      if (c === 'LIS') continue;
      expect(ticketBlock('LIS', c), c).toBeGreaterThan(0);
      expect(itinerary('LIS', c, 0, ticketBlock('LIS', c)).length, c).toBeGreaterThan(0);
    }
    for (const [typeId, ops] of Object.entries(EX_OPERATORS)) {
      expect(typeOf(typeId).id).toBe(typeId);
      expect(ops.length).toBeGreaterThan(0);
    }
  });

  it('offers carry a site, its text and (for used aircraft from an operator) the ex-operator; the return site is a lessor site', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const { o } of market(seed, 365).seen) {
        expect(o.site && AIRPORT_BY_CODE[o.site]).toBeTruthy();
        expect(o.where).toMatch(/\([A-Z]{3}\)$/);
        if (o.exOperator) expect(o.where).toBe(`ex-${o.exOperator}, ${AIRPORT_BY_CODE[o.site!].city} (${o.site})`);
        expect(LESSOR_SITES.map((s) => s.code)).toContain(returnSiteOf(o));
        if (LESSOR_SITES.some((s) => s.code === o.site)) expect(returnSiteOf(o)).toBe(o.site);
      }
    }
  });

  it('every new offer posts one market message (info, topic market, ref market) and a marketOffer pause request', () => {
    const g = newGame(5);
    clearPause();
    const n = g.messages.length;
    const id = devMarketOffer(g, 'a320ceo', { site: 'SNN' });
    expect(g.messages.length).toBe(n + 1);
    expect(g.messages[0]).toMatchObject({ tone: 'info', cat: 'company', topic: 'market', ref: { kind: 'market', id } });
    expect(g.messages[0].title).toBe('Market: A320ceo for lease');
    expect(takePause(new Set(['marketOffer']))).toBe('marketOffer');
    // A teaser says what it needs.
    devMarketOffer(g, 'b763');
    expect(g.messages[0].body).toMatch(/Needs Widebody operations first\.$/);
  });

  it('is deterministic per seed', () => {
    expect(market(9, 200).seen).toEqual(market(9, 200).seen);
  });
});

describe('marketView', () => {
  it('open offers newest first, with gate, delivery quote, crew line, days left and return terms; pure', () => {
    const g = newGame(6);
    const a = devMarketOffer(g, 'a320ceo', { site: 'SNN' });
    g.now += DAY;
    const b = devMarketOffer(g, 'b763', { site: 'FRA' });
    const before = JSON.stringify(g);
    const v = marketView(g);
    expect(JSON.stringify(g)).toBe(before);
    const ids = v.map((x) => x.offer.id);
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a));
    const nb = v.find((x) => x.offer.id === a)!;
    expect(nb.gate.ok).toBe(true);
    expect(nb.crew.level).toBe('ok');
    expect(nb.quote.legs.map((l) => l.from)).toEqual(['SNN']);
    expect(nb.quote.text).toMatch(/^SNN–LIS · 1 leg · ≈ \$/);
    expect(nb.quote.deadhead.length).toBeGreaterThan(0);
    expect(nb.returnText).toBe('Return at Shannon · 7-day check · cabin back to 180Y');
    expect(nb.daysLeft).toBeGreaterThanOrEqual(6);
    const wb = v.find((x) => x.offer.id === b)!;
    expect(wb.gate).toMatchObject({ ok: false, text: 'Needs Widebody operations' });
    expect(wb.crew.text).toBe('No B767 pilots: convert or hire (42 days)');
  });
});

describe('acquireAircraft and delivery', () => {
  it('refuses a closed gate, short cash and lapsed offers (in that order); a pending gate signs', () => {
    const g = newGame(4);
    const id = devMarketOffer(g, 'a332', { site: 'MAD' });
    const o = g.market.aircraft.find((x) => x.id === id)!;
    g.company.cash = 0;
    expect(acquireAircraft(g, 'nope')).toEqual({ ok: false, error: 'Offer not found' });
    expect(acquireAircraft(g, id)).toEqual({ ok: false, error: 'Needs Widebody operations: apply under Company → Ladder' });
    g.company.pendingApprovals.push({ id: 'widebody', started: g.now, done: g.now + 120 * DAY, cost: 0 });
    expect(aircraftGate(g, 'a332').ok).toBe(true);
    const r = acquireAircraft(g, id);
    expect(r.ok ? '' : r.error).toMatch(/^Not enough cash/);
    g.company.cash = 1e9;
    const now = g.now;
    g.now = o.expires;
    expect(acquireAircraft(g, id)).toEqual({ ok: false, error: 'This offer has expired' });
    g.now = now;
    expect(acquireAircraft(g, id).ok).toBe(true);
  });

  it('signs: deposit paid, delivering at the site, delivery ferry planned home, lease terms with return site; handed over at the site', () => {
    const g = newGame(4);
    g.company.cash = 50_000_000;
    const id = devMarketOffer(g, 'a320ceo', { site: 'VNO' });
    const o = { ...g.market.aircraft.find((x) => x.id === id)! };
    const cash = g.company.cash;
    const r = acquireAircraft(g, id);
    if (!r.ok) throw new Error(r.error);
    const ac = g.fleet[r.data!.aircraftId];
    expect(ac).toMatchObject({ status: 'delivering', at: 'VNO', typeId: 'a320ceo', deliveredAt: g.now + o.leadDays * DAY });
    expect(ac.delivery).toMatchObject({ site: 'VNO', handover: ac.deliveredAt });
    expect(ac.ownership).toMatchObject({ kind: 'dryLeaseIn', returnSite: 'VNO', deliveredLayout: 'all-economy', leaseStart: ac.deliveredAt });
    expect(g.company.cash).toBe(cash - o.deposit);
    expect(g.market.aircraft.some((x) => x.id === id)).toBe(false);
    const fs = ac.delivery!.ferryIds.map((f) => g.flights[f]);
    expect(fs.length).toBeGreaterThan(0);
    expect(fs.every((f) => f.kind === 'ferry' && f.purpose === 'delivery' && f.contractId === null)).toBe(true);
    expect(fs[0].from).toBe('VNO');
    expect(fs[fs.length - 1].to).toBe(g.company.homeBase);
    expect(fs[0].std).toBeGreaterThanOrEqual(ac.deliveredAt + 36 * 60);
    expect(g.messages[0].title).toBe(`A320ceo signed: ${ac.reg}`);
    expect(g.messages[0].body).toMatch(/Our pilots deadhead out on airline flights before that\./);
    advanceTo(g, ac.deliveredAt + 60, new Set());
    expect(ac.status).toBe('available');
    expect(ac.at).toBe('VNO');
    expect(g.stats.deliveries).toBe(1);
    expect(g.messages.some((m) => m.title === `${ac.reg} handed over at Vilnius`)).toBe(true);
    // A second delivery event is ignored.
    onDelivery(g, ev(g, 'aircraft.delivery', ac.id));
    expect(g.stats.deliveries).toBe(1);
  });

  it('a v0.6 delivery (no site) still joins at home base', () => {
    const g = newGame(4);
    const ac = leased(g);
    ac.status = 'delivering';
    delete ac.delivery;
    onDelivery(g, ev(g, 'aircraft.delivery', ac.id));
    expect(ac).toMatchObject({ status: 'available', at: g.company.homeBase });
    expect(g.messages[0].title).toBe(`${ac.reg} delivered`);
  });
});

describe('onLeaseEnd (holdover)', () => {
  it('extends month by month at +10% while the aircraft is busy', () => {
    const g = newGame(5);
    const ac = leased(g);
    if (ac.ownership.kind !== 'dryLeaseIn') throw new Error('no lease');
    ac.ownership.leaseEnd = g.now;
    ac.status = 'flying';
    const rent = ac.ownership.rentPerMonth;
    onLeaseEnd(g, ev(g, 'lease.end', ac.id));
    expect(g.fleet[ac.id]).toBe(ac);
    expect(ac.ownership.rentPerMonth).toBe(Math.round(rent * 1.1));
    expect(ac.ownership.leaseEnd).toBeGreaterThan(g.now + 29 * DAY);
    expect(g.messages[0].title).toBe(`Lease extended: ${ac.reg}`);
  });

  it('returns the aircraft at base when free and refunds the deposit; a booked return is left to its check', () => {
    const g = newGame(5);
    const ac = leased(g);
    if (ac.ownership.kind !== 'dryLeaseIn') throw new Error('no lease');
    ac.ownership.leaseEnd = g.now;
    ac.returning = { site: 'SNN', maintId: 'x', ferryIds: [], quote: 0 };
    onLeaseEnd(g, ev(g, 'lease.end', ac.id));
    expect(g.fleet[ac.id]).toBe(ac);
    delete ac.returning;
    ac.ownership.deposit = 456_000;
    ac.status = 'available';
    ac.at = g.company.homeBase;
    const cash = g.company.cash;
    onLeaseEnd(g, ev(g, 'lease.end', ac.id));
    expect(g.fleet[ac.id]).toBeUndefined();
    expect(g.company.cash).toBe(cash + 456_000);
    expect(g.messages[0].title).toBe(`${ac.reg} returned`);
  });
});

describe('refreshMarket', () => {
  it('drops expired offers and keeps fuel and demand indices in range', () => {
    const g = newGame(3);
    const k0 = monthKey(g.started);
    for (let m = 1; m <= 24; m++) {
      g.now = monthStart(k0 + m);
      refreshMarket(g);
    }
    expect(g.market.aircraft.every((o) => o.expires > g.now)).toBe(true);
    expect(g.market.fuelPrice).toBeGreaterThanOrEqual(550);
    expect(g.market.fuelPrice).toBeLessThanOrEqual(1050);
    for (const i of [g.market.narrowIndex, g.market.wideIndex]) expect(i).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------- v0.8 market cycle and outlook (UPDATE-0.8.md §4, §14) ----------

describe('market cycle (v0.8 §4)', () => {
  it('starts steady for 9 months; 50 years of phases follow the transition table and lengths', () => {
    const g = newGame(21);
    expect(g.market.cycle?.phase).toBe('steady');
    expect(Math.round((g.market.cycle!.until - g.now) / (30.44 * DAY))).toBe(9);
    const seen = new Map<string, number>();
    const pairs = new Set<string>();
    let prev: string | null = null;
    let since = g.now;
    let changes = 0;
    for (let i = 0; i < 600; i++) {
      g.now = monthStart(monthKey(g.now) + 1);
      g.messages.length = 0;
      refreshMarket(g);
      const cy = g.market.cycle!;
      if (cy.since === g.now) {
        changes++;
        if (prev) pairs.add(`${prev}>${cy.phase}`);
        // Lengths: boom 6–12, steady 9–18, soft 6–12, slump 6–12 months.
        const len = Math.round((cy.until - cy.since) / (30.44 * DAY));
        const [lo, hi] = ({ boom: [6, 12], steady: [9, 18], soft: [6, 12], slump: [6, 12] } as Record<string, number[]>)[cy.phase];
        expect(len).toBeGreaterThanOrEqual(lo);
        expect(len).toBeLessThanOrEqual(hi);
        // One message when the phase actually changes.
        if (prev && prev !== cy.phase) expect(g.messages.some((m) => /The ACMI market/.test(m.title))).toBe(true);
        since = g.now;
      }
      prev = cy.phase;
      seen.set(cy.phase, (seen.get(cy.phase) ?? 0) + 1);
      expect(g.market.narrowIndex).toBeGreaterThanOrEqual(0.75);
      expect(g.market.narrowIndex).toBeLessThanOrEqual(1.3);
    }
    expect(since).toBeGreaterThan(0);
    expect(changes).toBeGreaterThan(35);
    for (const p of ['boom', 'steady', 'soft', 'slump']) expect(seen.get(p) ?? 0, p).toBeGreaterThan(30);
    // Never steady → slump or boom → slump directly (only through soft).
    expect(pairs.has('steady>slump')).toBe(false);
    expect(pairs.has('boom>slump')).toBe(false);
    expect(pairs.has('slump>boom')).toBe(false);
  });

  it('the index converges to the phase target (± offset) within 6 months', () => {
    // Months 6–12 over 20 seeds: the index sits within 0.05 of target + offset (monthly noise N(0, 0.02)).
    for (const phase of ['boom', 'slump'] as const) {
      const tgt = BAL.v08.market.target[phase];
      let err = 0;
      let k = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const g = newGame(seed);
        g.market.narrowIndex = 1.0;
        g.market.wideIndex = 1.0;
        g.market.cycle = { phase, since: g.now, until: g.now + 400 * DAY, narrowOff: 0.03, wideOff: -0.02 };
        for (let i = 1; i <= 12; i++) {
          g.now = monthStart(monthKey(g.now) + 1);
          refreshMarket(g);
          if (i < 6) continue;
          err += Math.abs(g.market.narrowIndex - (tgt + 0.03)) + Math.abs(g.market.wideIndex - (tgt - 0.02));
          k += 2;
        }
      }
      expect(err / k, phase).toBeLessThan(0.05);
    }
  });

  it('shocks add to segIndex and expire; demand factor is the index squared; the outlook is pure', () => {
    const g = newGame(23);
    g.market.narrowIndex = 0.9;
    g.market.wideIndex = 1.0;
    g.market.shocks = [];
    addShock(g, { seg: 'narrow', delta: 0.12, until: g.now + 10 * DAY, text: 'GTF inspections' });
    expect(segIndex(g, 'narrow')).toBeCloseTo(1.02, 5);
    expect(segIndex(g, 'wide')).toBeCloseTo(1.0, 5);
    expect(demandFactor(g)).toBeCloseTo(1.02 * 1.02, 2);
    const before = JSON.stringify(g);
    const o = marketOutlook(g);
    expect(JSON.stringify(g)).toBe(before);
    expect(o.shocks[0].text).toMatch(/^GTF inspections: \+12 % narrowbody demand until /);
    expect(o.hajj.length).toBe(3);
    expect(o.narrow.text).toMatch(/^Narrowbody demand/);
    g.now += 11 * DAY;
    expect(segIndex(g, 'narrow')).toBeCloseTo(0.9, 5);
    g.now = monthStart(monthKey(g.now) + 1);
    refreshMarket(g);
    expect(g.market.shocks!.some((x) => x.text === 'GTF inspections')).toBe(false);
    // setPhase: a recession's slump, one message.
    const n = g.messages.length;
    setPhase(g, 'slump', 8);
    expect(g.market.cycle!.phase).toBe('slump');
    expect(g.messages.length).toBe(n + 1);
    expect(g.messages[0].title).toBe('The ACMI market is in a slump');
  });
});
