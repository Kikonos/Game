// v0.16.4 player bug reports (bugs1105): #1 Luxair's A320-size base let the offer dialog pick the A330; #5 CS-TQM sat
// at Hong Kong after the Hong Kong Airlines cover with nothing taking it home until the eve of its next job.

import { describe, expect, it } from 'vitest';
import { addFlight, flightsOf, ownFlightNo } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { feasibility, generateOffer, typeMisfit } from '.';
import { awayIdle, relinkPositioning } from './schedule';
import { addAircraft, leased, newGame } from './testkit';
import { postAwayIdle, problems } from '../problems';
import { awayIdleCard } from '../problems/fleet';
import { contractsModule } from './index';

const H = 60;
const pos = (g: GameState, acId: string): Flight[] => flightsOf(g, acId).filter((f) => f.kind === 'positioning' && f.status === 'scheduled');

describe('#1 Luxair: a narrowbody wet ask is not flown on a widebody', () => {
  it('an A320-size season base asks for a narrowbody; the A330 is a misfit with a reason, an A321 fits the type', () => {
    const g = newGame(61);
    const a330 = addAircraft(g, 'a332');
    const a321 = addAircraft(g, 'a321ceo');
    const o = generateOffer(g, 'seasonBase', { wide: false, window: false, paint: false, cabin: false })!;
    expect(o).toBeTruthy();
    expect(o.requirements.body).toBe('narrow');
    const wide = feasibility(g, o.id, a330.id);
    const body = wide.checks.find((c) => c.id === 'body');
    expect(body?.level).toBe('no');
    expect(body?.label).toMatch(/wants a narrowbody/);
    expect(body?.detail).toMatch(/fuel/);
    expect(typeMisfit(wide)).toBe(true);
    const nb = feasibility(g, o.id, a321.id);
    expect(nb.checks.some((c) => c.id === 'body')).toBe(false);
    expect(typeMisfit(nb)).toBe(false);
  });

  it('AOG cover for a narrowbody is a narrowbody; a widebody one still asks for a widebody', () => {
    const g = newGame(62);
    const nb = generateOffer(g, 'aogCover', { wide: false, window: false, paint: false, cabin: false })!;
    expect(nb.requirements.body).toBe('narrow');
    const wb = generateOffer(g, 'aogCover', { wide: true, window: false, paint: false, cabin: false });
    if (wb) expect(wb.requirements.body).toBe('wide');
  });

  it('a job fitted to a widebody\'s idle window is a widebody job (no "Follow-on: CS-TTL" on an A320-size ask)', () => {
    const g = newGame(63);
    const a330 = addAircraft(g, 'a332');
    const w = { aircraftId: a330.id, from: g.now + 30 * DAY, to: g.now + 200 * DAY, at: g.company.homeBase, afterContract: null };
    for (let i = 0; i < 6; i++) {
      const o = generateOffer(g, 'seasonBase', { window: w, paint: false, cabin: false });
      if (o) expect(o.requirements.body).toBe('wide');
    }
  });

  it('an open narrowbody ask in an older save gets body narrow on load, once; a countered one with a widebody keeps it', () => {
    const g = newGame(64);
    const a330 = addAircraft(g, 'a332');
    const o = generateOffer(g, 'seasonBase', { wide: false, window: false, paint: false, cabin: false })!;
    const c = generateOffer(g, 'aogCover', { wide: false, window: false, paint: false, cabin: false })!;
    delete o.requirements.body;
    delete c.requirements.body;
    c.status = 'countered';
    c.counter = { price: 1, at: g.now, replyAt: g.now + H, aircraftIds: [a330.id] };
    delete g.stats.narrowAsked;
    contractsModule.load!(g);
    expect(o.requirements.body).toBe('narrow');
    expect(c.requirements.body).toBeUndefined();
    delete o.requirements.body;
    contractsModule.load!(g);
    expect(o.requirements.body).toBeUndefined();
  });
});

/** An A320 that lands at Prague tomorrow morning from a job, and a hard empty ferry out of home 20 days later. */
function prague(g: GameState, ferryDays = 20) {
  const ac = leased(g);
  const day = Math.floor(g.now / DAY) * DAY + DAY;
  const blk = blockMinutes(ac.typeId, 'LIS', 'PRG');
  const inb = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'PRG', std: day + 8 * H, sta: day + 8 * H + blk, pax: 150 });
  const fb = blockMinutes(ac.typeId, 'LIS', 'ABJ');
  const ferry = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'LIS', to: 'ABJ', std: day + ferryDays * DAY, sta: day + ferryDays * DAY + fb });
  return { ac, inb, ferry };
}

describe('#5 CS-TQM: a long wait away is spent at home, also before an empty ferry out of home', () => {
  it('the move home leaves within a day of landing, not on the eve of the ferry (and it is a fixed point)', () => {
    const g = newGame(65);
    const { ac, inb, ferry } = prague(g);
    relinkPositioning(g, ac.id);
    const home = pos(g, ac.id).filter((f) => f.from === 'PRG' && f.to === 'LIS');
    expect(home.length).toBe(1);
    expect(home[0].std - inb.sta).toBeLessThan(DAY);
    expect(ferry.std - home[0].sta).toBeGreaterThan(10 * DAY);
    for (let i = 0; i < 3; i++) expect(relinkPositioning(g, ac.id)).toEqual([]);
  });

  it('a late move home kept from an older plan (the eve of the ferry) is planned again, early', () => {
    const g = newGame(66);
    const { ac, inb, ferry } = prague(g);
    const blk = blockMinutes(ac.typeId, 'PRG', 'LIS');
    const late = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'PRG', to: 'LIS', std: ferry.std - DAY, sta: ferry.std - DAY + blk });
    relinkPositioning(g, ac.id);
    const home = pos(g, ac.id).filter((f) => f.from === 'PRG' && f.to === 'LIS');
    expect(home.length).toBe(1);
    expect(home[0].std - inb.sta).toBeLessThan(DAY);
    // The kept leg is retimed (its id stays), not re-made.
    expect(home[0].id).toBe(late.id);
  });

  it('a short wait away (under 5 days) still moves as late as the job allows', () => {
    const g = newGame(67);
    const { ac, ferry } = prague(g, 3);
    relinkPositioning(g, ac.id);
    const home = pos(g, ac.id).filter((f) => f.from === 'PRG' && f.to === 'LIS');
    expect(home.length).toBe(1);
    expect(ferry.std - home[0].sta).toBeLessThan(DAY);
  });

  it('on the ground away with nothing planned at all (its job done): it goes home', () => {
    const g = newGame(68);
    const ac = leased(g);
    ac.at = 'PRG';
    relinkPositioning(g, ac.id);
    const home = pos(g, ac.id);
    expect(home.length).toBeGreaterThan(0);
    expect(home[0].from).toBe('PRG');
    expect(home[home.length - 1].to).toBe(g.company.homeBase);
    expect(awayIdle(g, ac.id)).toBeNull();
    for (let i = 0; i < 3; i++) expect(relinkPositioning(g, ac.id)).toEqual([]);
  });

  it('nothing is planned for an aircraft waiting at the seller for its delivery ferry or being handed back', () => {
    const g = newGame(69);
    const ac = leased(g);
    ac.at = 'PRG';
    ac.delivery = { site: 'PRG', where: 'Prague', handover: g.now, ferryIds: [] };
    relinkPositioning(g, ac.id);
    expect(pos(g, ac.id).length).toBe(0);
    expect(awayIdle(g, ac.id)).toBeNull();
  });

  it('no way home (an A320 at Honolulu, no ETOPS): a four-line card, told once a stay', () => {
    const g = newGame(70);
    const ac = leased(g);
    ac.at = 'HNL';
    relinkPositioning(g, ac.id);
    expect(pos(g, ac.id).length).toBe(0);
    const v = awayIdle(g, ac.id);
    expect(v?.why).toBe('route');
    const card = awayIdleCard(g, ac.id)!;
    expect(card.what).toMatch(/stuck at Honolulu with nothing planned/);
    expect(card.why).toMatch(/range and our ETOPS limit/);
    expect(card.hurt.money).toBeGreaterThan(0);
    expect(card.actions.length).toBeGreaterThan(0);
    expect(problems(g).some((c) => c.subject.kind === 'awayIdle' && c.subject.ref.id === ac.id)).toBe(true);
    expect(typeOf(ac.typeId).body).toBe('narrow');
    const n = g.messages.length;
    postAwayIdle(g);
    expect(g.messages.length).toBe(n + 1);
    expect(g.messages.some((m) => m.problem?.kind === 'awayIdle' && m.ref?.id === ac.id)).toBe(true);
    postAwayIdle(g);
    expect(g.messages.length).toBe(n + 1);
  });
});
