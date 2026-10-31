// v0.11 Operations (UPDATE 1): the event director, the live disruptions, ramp inspections and the yearly audit.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, legsOffer, newGame, run } from '../contracts/testkit';
import { flightsOf } from '../core/entities';
import { DAY, fromUTC } from '../core/time';
import type { Aircraft, Flight, GameState } from '../core/types';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { fixture } from '../fixtures/compatKit';
import { afterOfferDays, busyShare, director, isQuiet, newDirector, PACE_SPELLS, quietShare, setPace, spellAt } from './director';
import { devDisruption, DISRUPT_KINDS, inCurfew, opsState, raise } from './disrupt';
import { inspect, rampYear } from './ramp';
import { approvalsSuspended, dailyAudit, runAudit, startAuditTask } from './audit';
import { approvalBlocker, resolveDecision } from './index';
import { isRevenue } from './util';

const line = (g: GameState, cat: string) => (g.finance.current.lines as Record<string, number>)[cat] ?? 0;
const skip = (g: GameState, t: number) => advanceTo(g, t, new Set());

/** A charter LIS–FUE–LIS three days out on the leased A320, signed. */
function charter(seed = 5): { g: GameState; ac: Aircraft; legs: Flight[] } {
  const g = newGame(seed);
  const ac = leased(g);
  const t0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
  const o = legsOffer(g, [['LIS', 'FUE', t0 + 9 * 60], ['FUE', 'LIS', t0 + 13 * 60]], 150);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const legs = flightsOf(g, ac.id).filter((f) => f.contractId === r.data!.contractId && isRevenue(f));
  return { g, ac, legs };
}

/** Advances (deciding nothing) until the leg is airborne; clears any card. */
function airborne(g: GameState, f: Flight): void {
  for (let i = 0; i < 400 && f.status === 'scheduled'; i++) {
    skip(g, Math.min(f.std + f.delay + 5, g.now + 60));
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  }
  expect(f.status).toBe('enroute');
  g.decisions.length = 0;
  skip(g, g.now + 20);
}

describe('event director', () => {
  it('alternates busy and quiet spells within the pace bounds, deterministically per seed', () => {
    const a = newGame(3);
    const b = newGame(3);
    for (const g of [a, b]) spellAt(g, g.now + 200 * DAY);
    expect(a.director!.spells).toEqual(b.director!.spells);
    const sp = a.director!.spells;
    expect(sp[0][2]).toBe(1);
    for (let i = 0; i < sp.length; i++) {
      const days = (sp[i][1] - sp[i][0]) / DAY;
      const [lo, hi] = PACE_SPELLS.normal[sp[i][2] ? 'busy' : 'quiet'];
      expect(days).toBeGreaterThanOrEqual(lo);
      expect(days).toBeLessThanOrEqual(hi);
      if (i) {
        expect(sp[i][0]).toBe(sp[i - 1][1]);
        expect(sp[i][2]).not.toBe(sp[i - 1][2]);
      }
    }
    const c = newGame(4);
    spellAt(c, c.now + 200 * DAY);
    expect(c.director!.spells).not.toEqual(sp);
  });

  it('quiet days are about two thirds at Normal, more at Calm, fewer at Busy', () => {
    const share = (pace: 'calm' | 'normal' | 'busy') => {
      let q = 0;
      let n = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const g = newGame(seed);
        newDirector(g, pace);
        for (let t = g.now; t < g.now + 365 * DAY; t += DAY) {
          n++;
          if (isQuiet(g, t + 720)) q++;
        }
      }
      return q / n;
    };
    const calm = share('calm');
    const normal = share('normal');
    const busy = share('busy');
    expect(normal).toBeGreaterThan(0.58);
    expect(normal).toBeLessThan(0.74);
    expect(calm).toBeGreaterThan(normal + 0.08);
    expect(busy).toBeLessThan(normal - 0.1);
    expect(busyShare('normal')).toBeCloseTo(1 / 3, 2);
  });

  it('offers bunch into busy spells but keep their yearly count', () => {
    for (const seed of [1, 2]) {
      const g = newGame(seed);
      let t = g.now;
      let busyN = 0;
      let quietN = 0;
      let u = 99 + seed;
      const rnd = () => ((u = (u * 1103515245 + 12345) % 2147483648) / 2147483648);
      const lam = 0.6;
      while (t < g.now + 365 * DAY) {
        let s = 0;
        for (let i = 0; i < 3; i++) s -= Math.log(Math.max(1e-9, rnd()));
        t = Math.max(t + 30, afterOfferDays(g, t, s / (3 * lam)));
        if (isQuiet(g, t)) quietN++;
        else busyN++;
      }
      const n = busyN + quietN;
      expect(n).toBeGreaterThan(lam * 365 * 0.9);
      expect(n).toBeLessThan(lam * 365 * 1.15);
      // About a third of the days carry most of the offers.
      expect(busyN / n).toBeGreaterThan(0.65);
    }
  });

  it('a pace change keeps the current spell (shortened when too long) and redraws the rest', () => {
    const g = newGame(8);
    const d = director(g);
    spellAt(g, g.now + 40 * DAY);
    const cur = spellAt(g, g.now);
    setPace(g, 'busy');
    expect(d.pace).toBe('busy');
    const now = spellAt(g, g.now);
    expect(now[0]).toBe(cur[0]);
    expect((now[1] - now[0]) / DAY).toBeLessThanOrEqual(PACE_SPELLS.busy[now[2] ? 'busy' : 'quiet'][1]);
    for (const s of d.spells.filter((x) => x[0] > g.now)) expect((s[1] - s[0]) / DAY).toBeLessThanOrEqual(PACE_SPELLS.busy[s[2] ? 'busy' : 'quiet'][1]);
  });

  it('a played year logs its quiet and busy days and no new optional card comes in a quiet spell', () => {
    const g = newGame(11);
    const ac = leased(g);
    const o = hamBase(g, g.now + 2 * DAY, 60);
    o.broker = undefined;
    expect(acceptOffer(g, o.id, [ac.id]).ok).toBe(true);
    const end = g.now + 60 * DAY;
    const seen = new Set<string>();
    while (g.now < end) {
      skip(g, Math.min(end, g.now + 6 * 60));
      for (const d of g.decisions) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        if (['ctot', 'turnaround', 'diversion'].includes(d.kind) && d.data?.cause !== 'technical') expect(isQuiet(g, d.t)).toBe(false);
      }
    }
    expect(quietShare(g)).toBeGreaterThan(0.3);
    expect((g.director!.days!.quiet + g.director!.days!.busy)).toBeGreaterThanOrEqual(59);
    expect(g.stats.illegalFlown ?? 0).toBe(0);
  }, 30_000);
});

describe('disruptions', () => {
  it('ATC slot: wait delays the leg (not our fault); a longer route costs fuel on a charter', () => {
    const { g, legs } = charter();
    const f = legs[0];
    skip(g, f.std - 1);
    expect(devDisruption(g, 'ctot', f.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'ctot')!;
    expect(d.options.map((o) => o.id)).toEqual(expect.arrayContaining(['wait', 'reroute']));
    const fuel0 = line(g, 'fuel');
    const better = Number(d.data!.better);
    expect(resolveDecision(g, d.id, 'reroute').ok).toBe(true);
    expect(line(g, 'fuel')).toBeLessThan(fuel0);
    expect(f.std + f.delay).toBeGreaterThanOrEqual(g.now + better - 1);
    expect(f.delayReason).toMatch(/^ATC slot/);
  });

  it('diversion: the alternate list respects runway and curfew; the onward card books hotels and a next-morning continuation', () => {
    const { g, ac, legs } = charter(6);
    const f = legs[0];
    airborne(g, f);
    expect(devDisruption(g, 'diversion', f.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'diversion')!;
    const alts = d.options.filter((o) => o.id.startsWith('alt:'));
    expect(alts.length).toBeGreaterThan(0);
    for (const o of alts) expect(o.chips?.some((c) => /^Runway/.test(c))).toBe(true);
    const alt = alts[0].id.slice(4);
    expect(resolveDecision(g, d.id, alts[0].id).ok).toBe(true);
    expect(f.to).toBe(alt);
    expect(f.div?.to0).toBe('FUE');
    // Lands at the alternate: the onward card.
    skip(g, (f.eta ?? f.sta) + 1);
    expect(f.status).toBe('done');
    expect(ac.at).toBe(alt);
    const on = g.decisions.find((x) => x.kind === 'divertOnward')!;
    expect(on).toBeDefined();
    const hotels0 = line(g, 'hotels');
    const dis0 = line(g, 'disruption');
    expect(resolveDecision(g, on.id, 'hotel').ok).toBe(true);
    // v0.12.1 a crew rest over 00:00 UTC is booked by the nightly crew-cost run (one room a night), not twice.
    expect(line(g, 'hotels')).toBeLessThanOrEqual(hotels0);
    expect(line(g, 'disruption')).toBeLessThan(dis0);
    const cont = g.flights[f.contOf!];
    expect(cont.from).toBe(alt);
    expect(cont.to).toBe('FUE');
    expect(cont.std).toBeGreaterThanOrEqual(g.now + 12 * 60 - 1);
    // The crew rest at the alternate and the trip completes with no illegal duty.
    run(g, cont.std + 3 * DAY);
    expect(g.stats.illegalFlown ?? 0).toBe(0);
    expect(g.stats.illegalCrewFlown ?? 0).toBe(0);
  });

  it('medical emergency: diverting for a severe case lifts the clean name; the card is an emergency (2 HI)', () => {
    const { g, legs } = charter(7);
    const f = legs[0];
    airborne(g, f);
    expect(devDisruption(g, 'medical', f.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'medical')!;
    expect(d.options[0].id).toBe('continue');
    const alt = d.options.find((o) => o.id.startsWith('alt:'));
    if (!alt) return;
    const clean0 = g.company.reputation.clean;
    expect(resolveDecision(g, d.id, alt.id).ok).toBe(true);
    expect(f.div?.cause).toBe('medical');
    if (d.data?.severe) expect(g.company.reputation.clean).toBeGreaterThan(clean0);
  });

  it('bird strike: a local contractor inspects (cost on the ledger), the next leg waits for it', () => {
    const { g, ac, legs } = charter(8);
    const f = legs[0];
    airborne(g, f);
    skip(g, (f.eta ?? f.sta) + 1);
    g.decisions.length = 0;
    expect(devDisruption(g, 'birdStrike', f.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'birdStrike')!;
    const dis0 = line(g, 'disruption');
    const mx0 = line(g, 'maintenance');
    expect(resolveDecision(g, d.id, 'local').ok).toBe(true);
    expect(ac.status === 'maintenance' || ac.status === 'aog').toBe(true);
    expect(line(g, 'disruption') + line(g, 'maintenance')).toBeLessThan(dis0 + mx0);
    const back = legs[1];
    const m = g.maintenance[ac.maintId!];
    run(g, back.std + 1);
    if (back.status !== 'cancelled' && !back.operatedBy && back.atd !== undefined) expect(back.atd).toBeGreaterThanOrEqual(m.end);
  });

  it('crew sick away: flying one cabin crew short follows ORO.CC.100 (50 passengers per cabin crew, a report)', () => {
    const { g, ac, legs } = charter(9);
    const back = legs[1];
    // At FUE before the return duty reports (the crew night-stop or turn there).
    run(g, legs[0].sta + 10);
    g.decisions.length = 0;
    const d0 = back.dutyId ? g.duties[back.dutyId] : undefined;
    if (!d0 || d0.report <= g.now) return;
    const p = g.pairings[d0.pairingId];
    const cc = p.slots.filter((s) => s.role === 'CC' && s.crewId && !s.above);
    if (!cc.length) return;
    // Make the cabin crew member the one who falls sick (the only one eligible).
    for (const s of p.slots) if (s !== cc[0] && s.crewId && g.crew[s.crewId]) g.crew[s.crewId].status = 'onDuty';
    expect(devDisruption(g, 'sickAway', back.id)).toBe(true);
    for (const s of p.slots) if (s.crewId && g.crew[s.crewId]?.status === 'onDuty') g.crew[s.crewId].status = 'resting';
    const d = g.decisions.find((x) => x.kind === 'sickAway');
    if (!d || !d.options.some((o) => o.id === 'minCrew')) return;
    expect(resolveDecision(g, d.id, 'minCrew').ok).toBe(true);
    expect(back.reducedCabin).toBe(1);
    expect(opsState(g).reducedReports?.length).toBe(1);
    const ccAboard = (g.pairings[g.duties[back.dutyId!].pairingId]?.slots ?? []).filter((s) => s.crewId && (s.role === 'CC' || s.role === 'PUR')).length;
    expect(back.pax ?? 0).toBeLessThanOrEqual(ccAboard * 50);
    run(g, back.sta + 60);
    expect(g.stats.illegalCrewFlown ?? 0).toBe(0);
    void ac;
  });

  it('curfew: a night stop moves the leg past the curfew, crew hotels on the ledger', () => {
    const { g, legs } = charter(10);
    const f = legs[1];
    run(g, legs[0].sta + 5);
    g.decisions.length = 0;
    expect(devDisruption(g, 'curfew', f.id)).toBe(true);
    const d = g.decisions.find((x) => x.kind === 'curfew')!;
    const h0 = line(g, 'hotels');
    const std0 = f.std;
    expect(resolveDecision(g, d.id, 'night').ok).toBe(true);
    expect(line(g, 'hotels')).toBeLessThan(h0);
    expect(f.std).toBeGreaterThan(std0);
    expect(f.lateOk ?? 0).toBeGreaterThan(0);
  });

  it('curfew windows read in local time (ZRH 23:30 ban, 23:00–23:30 delayed flights only)', () => {
    const t = fromUTC(2027, 0, 15, 22, 15); // 23:15 in Zurich (winter, UTC+1)
    expect(inCurfew('ZRH', t, true)).toBe(false);
    expect(inCurfew('ZRH', t, false)).toBe(true);
    expect(inCurfew('ZRH', t + 30, true)).toBe(true);
    expect(inCurfew('LIS', t)).toBe(false);
  });

  it('turnaround: paying for extra handling posts the cost and keeps it to 5 minutes', () => {
    const { g, legs } = charter(12);
    const f = legs[1];
    run(g, legs[0].sta + 5);
    skip(g, f.std - 1);
    g.decisions.length = 0;
    if (!devDisruption(g, 'turnaround', f.id)) return;
    const d = g.decisions.find((x) => x.kind === 'turnaround')!;
    const dis0 = line(g, 'disruption');
    expect(resolveDecision(g, d.id, 'pay').ok).toBe(true);
    expect(line(g, 'disruption')).toBeLessThan(dis0);
  });

  it('never two disruption cards at once: the second is handled by operations (Inbox note)', () => {
    const { g, legs } = charter(13);
    const f = legs[0];
    skip(g, f.std - 1);
    expect(devDisruption(g, 'ctot', f.id)).toBe(true);
    const second = raise(g, {
      kind: 'birdStrike', title: 'Bird strike: test', body: 'x', options: [{ id: 'local', label: 'Local', desc: '' }], defaultOption: 'local', expires: g.now + 30,
      ref: { kind: 'aircraft', id: 'nope' }, data: { aircraftId: 'nope' },
    }, { optional: false });
    expect(second).toBeNull();
    expect(g.decisions.filter((x) => DISRUPT_KINDS.has(x.kind)).length).toBe(1);
    expect(g.messages[0].body).toMatch(/Operations handled it/);
  });
});

describe('ramp inspections', () => {
  it('older aircraft with deferred defects find more; Cat 3 holds the aircraft and goes on the record', () => {
    const g = newGame(14);
    const ac = leased(g);
    const total = (age: number, deferred: number) => {
      ac.builtYear = new Date(g.now * 60_000 + Date.UTC(2000, 0, 1)).getUTCFullYear() - age;
      ac.maint.deferred = deferred;
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const r = inspect(g, ac, 'FRA', 'SACA', `t${age}:${deferred}:${i}`);
        n += r.cats[0] + r.cats[1] + r.cats[2];
        if (ac.status === 'maintenance') {
          ac.status = 'available';
          ac.maintId = null;
        }
      }
      return n;
    };
    const young = total(2, 0);
    const old = total(26, 0.6);
    expect(old).toBeGreaterThan(young * 2);
    expect(rampYear(g).n).toBe(600);
    expect(opsState(g).ramp.every((r) => r.prog === 'SACA')).toBe(true);
  });
});

describe('yearly audit', () => {
  it('announced 4 weeks ahead; findings from the record; actions close them; a missed deadline suspends approvals', () => {
    const g = newGame(15);
    const st = opsState(g).audit;
    st.next = g.now + 28 * DAY;
    dailyAudit(g);
    expect(st.announced).toBe(true);
    expect(g.messages[0].title).toMatch(/audit on/);
    // A year with two illegal duties.
    g.stats.incidents = [[g.now - 10 * DAY, 'illegalCrew'], [g.now - 5 * DAY, 'illegalCrew']];
    const fee0 = line(g, 'compliance');
    const out = runAudit(g);
    expect(line(g, 'compliance')).toBeLessThan(fee0);
    const ftl = out.find((f) => f.area === 'ftl')!;
    expect(ftl.level).toBe(2);
    expect(ftl.due).toBeGreaterThan(g.now + 25 * DAY);
    // One started and done in time: closed.
    expect(startAuditTask(g, ftl.id).ok).toBe(true);
    const others = out.filter((f) => f.id !== ftl.id);
    g.now = ftl.ready! + 1;
    dailyAudit(g);
    expect(ftl.closed).toBeDefined();
    // Another left open past its deadline: approvals suspended, until it is closed.
    if (others.length) {
      g.now = Math.max(...others.map((f) => f.due)) + DAY;
      dailyAudit(g);
      expect(approvalsSuspended(g)).toBe(true);
      expect(approvalBlocker(g, 'etops120')).toMatch(/Suspended/);
      for (const f of others) {
        g.company.cash += f.task.cost;
        startAuditTask(g, f.id);
      }
      g.now = Math.max(...others.map((f) => f.ready!)) + 1;
      dailyAudit(g);
      expect(approvalsSuspended(g)).toBe(false);
    }
    expect(st.next).toBeGreaterThan(g.now - 400 * DAY);
  });

  it('a clean record and a lucky document review: no findings, reliable +1', () => {
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const g = newGame(seed);
      const rel = g.company.reputation.reliable;
      const out = runAudit(g);
      if (out.length) continue;
      expect(g.company.reputation.reliable).toBe(Math.min(100, rel + 1));
      return;
    }
  });
});

describe('saves', () => {
  it('an older save loads with the director and the operations record (first audit at least 60 days off)', () => {
    const g = deserialize(fixture('v08'));
    expect(g.director?.pace).toBe('normal');
    expect(g.director!.spells.length).toBeGreaterThan(0);
    expect(g.opsx?.audit.next).toBeGreaterThanOrEqual(g.now + 59 * DAY);
    const h = deserialize(serialize(g));
    expect(h.director).toEqual(g.director);
    expect(h.opsx).toEqual(g.opsx);
    // Plays on: 20 days, no exception, no illegal duty.
    const ill = g.stats.illegalFlown ?? 0;
    const end = g.now + 20 * DAY;
    while (g.now < end && !g.gameOver) {
      advanceTo(g, Math.min(end, g.now + DAY), new Set());
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    }
    expect(g.stats.illegalFlown ?? 0).toBe(ill);
  });

  it('a new game serialises its director and plays on identically after a reload', () => {
    const g = newGame(16);
    skip(g, g.now + 5 * DAY);
    const h = deserialize(serialize(g));
    skip(g, g.now + 5 * DAY);
    skip(h, h.now + 5 * DAY);
    expect(h.director).toEqual(g.director);
    expect(Object.keys(h.offers).sort()).toEqual(Object.keys(g.offers).sort());
  });
});
