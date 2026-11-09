// Bug reports of 8 Nov (second export, the player's save 'Blue Airlines' 24 Nov – 9 Dec 2028):
// #1 Carolina Almeida's annual leave planned at Manila (she should fly home to Lisbon first, and back if needed);
// #2 a 'Days off' morale hit with 8 days off of 7; #3 two captains on VN6000 (a far-base reserve flying along);
// #4 CP7040 MNL–KIX: CREW OUT OF HOURS 'the cabin crew cannot all rest in this cruise' on a plain day, again and again.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize, serialize } from '../save';
import { ALARM_HOOKS } from './control';
import { checkAlarm } from './selfCheck';
import { crewAlertKind, outOfHours } from './outOfHours';
import { flightCrewStatus } from './roster';
import { restMarked } from './restMarks';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import { dailyMorale, moraleOf } from './morale';
import { addCrew, fixtureGame } from './fixtures';
import { advanceTo } from '../sim';
import { segsOf, locAt, standsBy } from './timeline';
import { isPilot } from '../core/perf';
import { crewCalendar } from './calendar';

const snap04 = () => deserialize(fixture('v0182-cp7040'));
const snap01 = () => deserialize(fixture('v0182-leave'));

describe('#4 CP7040: a rest mark from an earlier duty of the tour', () => {
  it('on load the marks left by CP7020 (6 Dec) are gone: CP7040 is a plain day, no alarm, no hold', () => {
    const g = snap04();
    const f = g.flights.f3rxe;
    const d = g.duties[f.dutyId!];
    expect(d.augment).toBe(0);
    expect(g.pairings[d.pairingId].slots.some((s) => s.ooh?.limit === 'inflightRest')).toBe(false);
    expect(restMarked(g.pairings[d.pairingId], d)).toBe(false);
    expect(crewAlertKind(g, f.id)).toBe(null);
    expect(outOfHours(g, f.id)).toEqual([]);
    expect(flightCrewStatus(g, f.id).level).not.toBe('illegal');
  });

  it('a stale mark (as an older build left it) never speaks for a later duty, and the self-check refutes the claim', () => {
    const g = snap04();
    const f = g.flights.f3rxe;
    const d = g.duties[f.dutyId!];
    const p = g.pairings[d.pairingId];
    // The mark as v0.18.2 left it: no duty named, made on 6 Dec at CP7020's gate.
    for (const s of p.slots) if (s.crewId && (s.role === 'PUR' || s.role === 'CC')) s.ooh = { crewId: s.crewId, limit: 'inflightRest', over: 0, at: d.report - 3 * 24 * 60 };
    expect(restMarked(p, d)).toBe(false);
    expect(crewAlertKind(g, f.id)).toBe(null);
    // A mark that does name this (plain) duty is no claim either: the day needs no in-flight rest.
    for (const s of p.slots) if (s.ooh) s.ooh.dutyId = d.id;
    expect(restMarked(p, d)).toBe(false);
    const v = checkAlarm(g, 'hours', f.id, ALARM_HOOKS, p.slots.filter((s) => s.ooh).map((s) => ({ crewId: s.crewId!, code: 'inflightRest' })));
    expect(v.confirmed).toBe(false);
    expect(v.evidence.join(' ')).toMatch(/not an augmented day/);
  });
});

describe('#2 Carolina Almeida: a "Days off" debuff with 8 days off of 7', () => {
  it('on load the hit from a published day off moved is "Day off moved", and days off away weigh nothing', () => {
    const g = snap01();
    const c = g.crew.c32u5;
    // 9, 8, 8, 8, 9 days off in the months closed: never under the legal 7.
    expect(Object.values(c.offMonths ?? {}).every((n) => n >= 7)).toBe(true);
    expect(c.moraleWhy?.daysOff).toBeUndefined();
    expect(c.moraleWhy?.offAway).toBeUndefined();
    expect(c.moraleWhy?.offMoved).toBeLessThan(0);
    const labels = moraleOf(g, c.id).drivers.map((d) => d.label);
    expect(labels).not.toContain('Days off');
    expect(labels).not.toContain('Days off away');
    expect(labels).toContain('Day off moved');
  });

  it('a day off at the hotel is no driver; back from annual leave a lift that lasts months', () => {
    const g = fixtureGame();
    const c = g.crew[addCrew(g, { CC: 1 })[0]];
    c.awaySince = g.now - 5 * DAY;
    c.loc = 'HAM';
    c.morale = 60;
    dailyMorale(g);
    expect(c.moraleWhy?.offAway).toBeUndefined();
    // Two weeks of annual leave that ended yesterday.
    c.loc = c.base;
    c.awaySince = null;
    c.blocks = [{ from: g.now - 15 * DAY, to: g.now - DAY, why: 'leave', annual: true }];
    const m0 = c.morale;
    dailyMorale(g);
    expect(c.leaveBack).toBe(g.now - DAY);
    expect(c.morale - m0).toBeGreaterThanOrEqual(BAL.morale.leaveLift.back);
    expect(moraleOf(g, c.id).drivers.find((d) => d.key === 'leave')?.value).toBeGreaterThan(0);
    // Once per leave, and still lifting two months on (the glow), gone after the few months.
    const once = c.morale;
    dailyMorale(g);
    expect(c.morale - once).toBeLessThan(1);
    g.now += 60 * DAY;
    const why = { ...c.moraleWhy };
    dailyMorale(g);
    expect((c.moraleWhy?.leave ?? 0) - (why.leave ?? 0) * BAL.morale.whyDecay).toBeGreaterThan(0);
    g.now += 40 * DAY;
    c.moraleWhy = {};
    dailyMorale(g);
    expect(c.moraleWhy?.leave).toBeUndefined();
  });
});

describe('#1 Carolina Almeida: annual leave from away (v0.19.3: deadhead home on its first day, back on its last)', () => {
  it('from the next daily run she stays on station until the leave, flies home on its first day and back out to her tour on its last', () => {
    const g = snap01();
    const t0 = Math.floor(g.now / DAY) * DAY + DAY + 30;
    while (g.now < t0) advanceTo(g, Math.min(t0, g.now + 12 * 60), new Set());
    const c = g.crew.c32u5;
    const leave = c.blocks!.find((b) => b.why === 'leave')!;
    const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.crewIds.includes(c.id)).sort((a, b) => a.std - b.std);
    // No trip home before the leave (it took days of the rotation): the leave's own trip on its first day.
    expect(tickets.find((f) => f.to === 'LIS' && f.sta <= leave.from)).toBeUndefined();
    const home = tickets.find((f) => f.leaveTrip === 'home')!;
    expect(home.from).toBe('MNL');
    expect(home.std).toBeGreaterThanOrEqual(leave.from);
    expect(home.std).toBeLessThan(leave.from + DAY);
    expect(home.why).toMatch(/Annual leave/);
    expect(locAt(c, segsOf(g, c), leave.from)).toBe('MNL');
    expect(locAt(c, segsOf(g, c), leave.from + DAY + 12 * 60)).toBe('LIS');
    // Her part of the tour after the leave (CP7040 on 21 Dec): back out on the leave's last day.
    const p = g.pairings.p3tok;
    if (p.slots.some((s) => s.crewId === c.id)) {
      const back = tickets.find((f) => f.leaveTrip === 'back')!;
      expect(back).toMatchObject({ from: 'LIS', to: 'MNL' });
      expect(back.std).toBeGreaterThanOrEqual(leave.to - DAY);
      expect(back.std).toBeLessThan(leave.to);
    }
  });

  it('played on, she spends the leave in Lisbon (the leave keeps its dates)', () => {
    const g = snap01();
    const c = g.crew.c32u5;
    const leave = { ...c.blocks!.find((b) => b.why === 'leave')! };
    while (g.now < leave.from + 2 * DAY) advanceTo(g, Math.min(leave.from + 2 * DAY, g.now + 12 * 60), new Set());
    expect(c.loc).toBe('LIS');
    expect(c.status).toBe('leave');
    expect(c.blocks!.find((b) => b.why === 'leave')).toMatchObject({ from: leave.from, to: leave.to });
  }, 120_000);
});


describe('#3 VN6000: two captains (a far base reserve flying with the set)', () => {
  it('on load no flight lists more pilots than its duty needs: the reserve and the relief pilots stand by at the station', () => {
    const g = snap04();
    let n = 0;
    for (const f of Object.values(g.flights)) {
      if (f.status !== 'scheduled' || f.kind === 'deadhead' || !f.dutyId || !g.duties[f.dutyId]) continue;
      const d = g.duties[f.dutyId];
      expect(f.crewIds.filter((id) => g.crew[id] && isPilot(g.crew[id].role)).length, `${f.no} ${f.from}-${f.to}`).toBeLessThanOrEqual(2 + d.augment);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    const vn = Object.values(g.flights).filter((f) => f.no === 'VN6000' && f.status === 'scheduled').sort((a, b) => a.std - b.std)[0];
    const d = g.duties[vn.dutyId!];
    const p = g.pairings[d.pairingId];
    const res = p.slots.filter((s) => s.reserve && s.crewId);
    expect(res.length).toBeGreaterThan(0);
    for (const s of res) {
      expect(vn.crewIds).not.toContain(s.crewId);
      expect(standsBy(g, p, d, s.crewId!)).toBe(true);
    }
    // CP7040 (a plain day of the Manila set: 4 pilots on station for its augmented days): two of them fly it.
    const cp = g.flights.f3rxe;
    expect(cp.crewIds.filter((id) => isPilot(g.crew[id].role)).length).toBe(2);
  });

  it('a reserve already in the air with the set when the save was made flies the rest of that duty home (never left at the outstation)', () => {
    // The 8 Nov export (bugs1108 current): Carolina Silva (the SGN set's reserve purser) was aboard VN6040 SGN–HAN; the
    // load repair took her off VN6041 HAN–SGN and she stayed at Hanoi until a ticket from Saigon 2 weeks later.
    const g0 = snap04();
    const vn = Object.values(g0.flights).filter((f) => f.no === 'VN6000' && f.status === 'scheduled').sort((a, b) => a.std - b.std)[0];
    const d = g0.duties[vn.dutyId!];
    const p = g0.pairings[d.pairingId];
    const res = p.slots.find((s) => s.reserve && s.crewId)!.crewId!;
    expect(d.flightIds.length).toBeGreaterThan(1);
    // As an older build left it: the reserve listed on every sector of the duty, the first under way.
    for (const fid of d.flightIds) g0.flights[fid].crewIds = [...g0.flights[fid].crewIds, res];
    g0.flights[d.flightIds[0]].status = 'enroute';
    const g = deserialize(serialize(g0));
    expect(standsBy(g, g.pairings[p.id], g.duties[d.id], res)).toBe(false);
    for (const fid of d.flightIds.slice(1)) expect(g.flights[fid].crewIds, g.flights[fid].no).toContain(res);
  });

  it('the reserve stands by at the hotel (a quarter counted as duty, no flying), shows so on the calendar, and is logged so', () => {
    const g = snap04();
    const vn = Object.values(g.flights).filter((f) => f.no === 'VN6000' && f.status === 'scheduled').sort((a, b) => a.std - b.std)[0];
    const d = g.duties[vn.dutyId!];
    const p = g.pairings[d.pairingId];
    const r = g.crew[p.slots.find((s) => s.reserve && s.crewId && isPilot(s.role))!.crewId!];
    const seg = segsOf(g, r).find((x) => x.dutyId === d.id && x.kind === 'duty')!;
    expect(seg.block).toBe(0);
    expect(seg.fdp).toBe(0);
    expect(seg.share).toBe(BAL.v09.roster.share.hotel);
    expect(seg.at).toBe('SGN');
    const cal = crewCalendar(g, r.id, d.report - 60, d.release + 60);
    expect(cal.some((b) => b.kind === 'standby' && /Reserve/.test(b.label))).toBe(true);
    expect(cal.some((b) => b.kind === 'duty' && b.dutyId === d.id)).toBe(false);
    const log0 = r.log.length;
    const hours = r.totalHours;
    while (g.now < d.release + 120) advanceTo(g, Math.min(d.release + 120, g.now + 6 * 60), new Set());
    expect(g.duties[d.id]?.done ?? true).toBe(true);
    expect(r.log.length).toBe(log0);
    expect(r.totalHours).toBe(hours);
    expect(r.loc).toBe('SGN');
    expect(r.status).not.toBe('onDuty');
    expect((r.standby ?? []).some((w) => w.kind === 'hotel' && w.at === 'SGN' && w.from <= d.report + 60 && w.to >= d.release - 120)).toBe(true);
  }, 120_000);
});
