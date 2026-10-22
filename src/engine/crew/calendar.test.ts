// v0.5.2 crew calendar strip and card header.

import { describe, expect, it } from 'vitest';
import { addDeadhead, addFlight, touchFlights } from '../core/entities';
import { ticketBlock } from '../ops/commercial';
import { isPilot } from '../core/perf';
import { DAY, fmtDate } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';
import { autoRoster, crewCalendar, crewStatusView, hireCrew, trainCrew } from '.';
import { addCrew, at, fixtureContract, fixtureGame } from './fixtures';

function trip(g: GameState) {
  const ac = Object.values(g.fleet)[0];
  ac.at = 'LIS';
  addCrew(g, { CPT: 3, FO: 3, PUR: 3, CC: 9 });
  const c = fixtureContract(g, { aircraftIds: [ac.id], start: at(g, 2), end: at(g, 5), pattern: { kind: 'legs', legs: [] }, archetype: 'adhoc' });
  const mk = (kind: Flight['kind'], from: string, to: string, d: number, hhmm: number, blk: number) =>
    addFlight(g, { no: `X${d}${hhmm}`, aircraftId: ac.id, contractId: c.id, kind, from, to, std: at(g, d, hhmm), sta: at(g, d, hhmm) + blk });
  mk('positioning', 'LIS', 'ZAG', 2, 10 * 60, 185);
  mk('revenue', 'ZAG', 'SVQ', 3, 8 * 60, 195);
  const r2 = mk('revenue', 'SVQ', 'ZAG', 3, 12 * 60, 195);
  const out = mk('positioning', 'ZAG', 'LIS', 4, 10 * 60, 185);
  autoRoster(g, { aircraftIds: [ac.id], to: g.now + 10 * DAY });
  return { r2, out };
}

const noOverlap = (bs: ReturnType<typeof crewCalendar>) => {
  const flat = bs.filter((b) => ['duty', 'positioning', 'deadhead', 'rest', 'off'].includes(b.kind));
  for (let i = 1; i < flat.length; i++) expect(flat[i].start, `${flat[i - 1].kind}→${flat[i].kind}`).toBeGreaterThanOrEqual(flat[i - 1].end);
};

describe('crew travelling', () => {
  it('crew on an airline deadhead read Deadheading in the air, not Available or Resting at the departure', () => {
    const g = fixtureGame(53);
    const ids = addCrew(g, { CPT: 1, CC: 1 });
    for (const id of ids) g.crew[id].loc = 'PMI';
    const std = g.now + 120;
    const f = addDeadhead(g, { crewIds: ids, from: 'PMI', to: 'LIS', std, sta: std + ticketBlock('PMI', 'LIS'), cost: 0 });
    g.now = std - 30;
    expect(crewStatusView(g, ids[0]).label).toBe('Deadheading');
    expect(crewStatusView(g, ids[0]).nowAt).toMatch(/check-in/);
    g.now = std + 30;
    const v = crewStatusView(g, ids[0]);
    expect(v.label).toBe('Deadheading');
    expect(v.text).toMatch(/^[A-Z0-9]{2} \d+ PMI→LIS · lands \d\d:\d\d$/);
    expect(v.nowAt).toBe('in the air PMI→LIS');
    expect(v.until).toBe(f.sta);
    expect(v.travel?.flightId).toBe(f.id);
    g.now = f.sta + 1;
    expect(crewStatusView(g, ids[0]).label).not.toBe('Deadheading');
  });

  it('calendar blocks have unique kind/start keys (no doubled rest block)', () => {
    const g = fixtureGame(54);
    trip(g);
    for (let t = g.now; t < g.now + 5 * DAY; t += 6 * 60) {
      advanceTo(g, t, new Set());
      for (const c of Object.values(g.crew)) {
        const bs = crewCalendar(g, c.id, g.now, g.now + 14 * DAY);
        const keys = bs.map((b) => `${b.kind}-${b.dutyId ?? ''}-${b.start}`);
        expect(new Set(keys).size, c.id).toBe(keys.length);
      }
    }
  });
});

describe('crew calendar', () => {
  it('a joining captain: "Joins <date>", no fake rest, the strip shows the joining period', () => {
    const g = fixtureGame(51);
    const res = hireCrew(g, { role: 'CPT', family: 'A320', base: 'LIS', count: 1 });
    expect(res.ok).toBe(true);
    const id = res.ok ? res.data!.crewIds[0] : '';
    const c = g.crew[id];
    const ready = g.hires.find((h) => h.crewId === id)!.ready;
    expect(c.restUntil).toBeLessThanOrEqual(g.now);
    const v = crewStatusView(g, id);
    expect(v.label).toBe('Joining');
    expect(v.text).toBe(`Joins ${fmtDate(ready)}`);
    expect(v.restUntil).toBeNull();
    expect(v.startLabel).toBe('Joins');
    expect(v.startDate).toBe(ready);
    const cal = crewCalendar(g, id, g.now, g.now + 14 * DAY);
    expect(cal.length).toBeGreaterThan(0);
    expect(cal[0].kind).toBe('joining');
    expect(cal[0].detail).toContain(`Joins ${fmtDate(ready)}`);
    expect(cal.some((b) => b.kind === 'rest')).toBe(false);
    if (ready > g.now + 14 * DAY) expect(cal.every((b) => b.kind === 'joining')).toBe(true);
    // Old saves: a future `hired` and restUntil on a joining crew member still read as joining.
    c.restUntil = ready;
    expect(crewStatusView(g, id).restUntil).toBeNull();
  });

  it('sick and training windows show with their end dates', () => {
    const g = fixtureGame(52);
    const [a, b] = addCrew(g, { CC: 1, FO: 1 });
    g.crew[a].blocks = [{ from: g.now - 60, to: g.now + 3 * DAY, why: 'sick' }];
    g.crew[a].status = 'sick';
    const v = crewStatusView(g, a);
    expect(v.label).toBe('Sick');
    expect(v.text).toMatch(/^Sick · back ~\d+ \w+$/);
    expect(v.restUntil).toBeNull();
    const cal = crewCalendar(g, a, g.now, g.now + 14 * DAY);
    expect(cal.find((x) => x.kind === 'sick')?.detail).toMatch(/expected back/);
    expect(cal.some((x) => x.kind === 'off')).toBe(true);
    g.company.cash = 1e9;
    expect(trainCrew(g, b, 'typeRating', 'A330/340').ok).toBe(true);
    // v0.6: a conversion class from the earliest start, labelled 'Conversion A330' on the strip and the status line.
    const k = Object.values(g.classes!)[0];
    const blk = crewCalendar(g, b, g.now, g.now + 14 * DAY).find((x) => x.kind === 'training')!;
    expect(blk.label).toBe('Conversion A330');
    expect(blk.detail).toMatch(/^Class A330-P1 · Ground school d1–12 · ends /);
    expect(blk.start).toBe(k.start);
    advanceTo(g, k.start + 60);
    const t = crewStatusView(g, b);
    expect(t.label).toBe('Training');
    expect(t.text).toMatch(/^Conversion A330 · until \d+ \w+$/);
  });

  it('duties with typed legs, rest, a deadhead on a real airline and days off', () => {
    const g = fixtureGame(53);
    const t = trip(g);
    const cabin = t.r2.crewIds.find((id) => !isPilot(g.crew[id].role))!;
    const pilot = t.out.crewIds[0];
    const from = g.now;
    const cc = crewCalendar(g, cabin, from, from + 14 * DAY);
    const duties = cc.filter((b) => b.kind === 'duty');
    expect(duties.length).toBe(2);
    expect(duties[0].flights![0].type).toBe('positioning');
    expect(duties[1].flights!.every((f) => f.type === 'operating')).toBe(true);
    const dh = cc.find((b) => b.kind === 'deadhead')!;
    expect(dh).toBeTruthy();
    expect(dh.detail).toMatch(/[A-Z0-9]{2} \d{1,4} ZAG–/);
    expect(cc.some((b) => b.kind === 'rest')).toBe(true);
    expect(cc.some((b) => b.kind === 'off')).toBe(true);
    noOverlap(cc);
    const pc = crewCalendar(g, pilot, from, from + 14 * DAY);
    expect(pc.some((b) => b.kind === 'duty' && b.label === 'Ferry duty')).toBe(true);
    noOverlap(pc);
    // Riding our own empty leg as a passenger is 'positioning'.
    const extra = Object.values(g.crew).find((c) => c.role === 'CC' && !crewCalendar(g, c.id, from, from + 14 * DAY).some((b) => b.kind === 'duty'))!;
    t.out.riders = [extra.id];
    touchFlights(g);
    expect(crewCalendar(g, extra.id, from, from + 14 * DAY).find((b) => b.kind === 'positioning')?.detail).toMatch(/Riding our ferry leg/);
    // The header follows the day: on duty, then resting.
    advanceTo(g, at(g, 3, 9 * 60));
    expect(crewStatusView(g, cabin).label).toBe('On duty');
  });
});
