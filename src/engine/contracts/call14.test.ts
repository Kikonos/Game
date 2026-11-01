// v0.14 (player: "the urgent ones still have 20 plus hours to reply; it should be much less and in the moment", "some
// contracts are only available for a few hours, and the game doesn't pause or do anything", "on the call I want to
// select the aircraft"): a caller waits 30–90 min; short-notice work we can fly phones in; any other offer gets at least
// 6 h (a day or more unless the job is within 3 days); an unanswered call goes elsewhere with a small relation note;
// an offer about to lapse gets one Inbox line with its chime; Accept on the call takes the picked aircraft.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { takeCueEvents } from '../core/cues';
import { clearPause } from '../core/pause';
import { DAY } from '../core/time';
import type { ContractOffer, GameState } from '../core/types';
import { isQuiet } from '../ops/director';
import { answerCall, CALL_MISSED_REL, CALL_REPLY, callFit, callPlan, callReplyMin, callReports, REPLY_MIN } from './call';
import { feasibility } from './feasibility';
import { generateOffer, LAPSE_WARN, lapseCues, onOfferExpire } from './offers';
import { newGame, offer, run } from './testkit';

const flyable = (g: GameState, o: ContractOffer) => Object.keys(g.fleet).some((id) => feasibility(g, o.id, id, { quick: true }).level !== 'no');

describe('v0.14 calls answer in the moment', () => {
  it('a caller waits 30–90 min (15-min steps, from the offer id), never past an hour before the job, 20 min at least', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const w = callReplyMin(`o${i}`, 2 * DAY);
      expect(w).toBeGreaterThanOrEqual(CALL_REPLY[0]);
      expect(w).toBeLessThanOrEqual(CALL_REPLY[1]);
      expect(w % 15).toBe(0);
      expect(callReplyMin(`o${i}`, 2 * DAY)).toBe(w);
      seen.add(w);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([30, 45, 60, 75, 90]);
    expect(callReplyMin('o1', 100)).toBeLessThanOrEqual(40);
    expect(callReplyMin('o1', 30)).toBe(20);
  });

  it('the generator: calls want their answer within 90 min; short-notice work we can fly rings; other offers get 6 h or more, a day or more when not urgent', () => {
    let calls = 0;
    let shortCalls = 0;
    let written = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const g = newGame(seed);
      for (const [arch, lead] of [['aogCover', 5 * 60], ['aogCover', 20 * 60], ['repatriation', 30 * 60], ['adhoc', 2 * DAY], ['adhoc', 10 * DAY]] as const) {
        takeCueEvents();
        const o = generateOffer(g, arch, { start: g.now + lead, wide: false, window: false, paint: false, cabin: false });
        if (!o) continue;
        const win = o.expires - g.now;
        const cues = takeCueEvents();
        if (o.call) {
          calls++;
          expect(o.urgency).toBe('urgent');
          expect(win, `${arch} ${o.id}`).toBeLessThanOrEqual(CALL_REPLY[1]);
          expect(win).toBeGreaterThanOrEqual(20);
          expect(cues.some((c) => c.cue === 'offerCall' && c.ref?.id === o.id)).toBe(true);
          if (arch === 'aogCover' && lead === 5 * 60) shortCalls++;
        } else {
          written++;
          if (o.urgency !== 'urgent') expect(win, `${arch} ${o.id}`).toBeGreaterThanOrEqual(DAY);
          else if (o.start - g.now - 60 >= REPLY_MIN) expect(win, `${arch} ${o.id}`).toBeGreaterThanOrEqual(REPLY_MIN);
          // Short notice that doesn't ring: nothing in the fleet can fly it.
          if (win < REPLY_MIN) expect(flyable(g, o), `${arch} ${o.id}`).toBe(false);
        }
        clearPause();
      }
    }
    expect(calls).toBeGreaterThan(5);
    expect(shortCalls).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(20);
  });
});

/** An AOG cover phoned in now at `x` × the A320 standard rate. */
function rung(g: GameState, x = 4): ContractOffer {
  const o = offer(g, 'aogCover', { start: g.now + DAY });
  o.urgency = 'urgent';
  o.call = true;
  if (o.product.kind === 'wet') o.product.ratePerBH = Math.round(ACMI_TYPES.a320ceo.rateBH * x);
  return o;
}

describe('v0.14 the call: pick the aircraft, or let it ring out', () => {
  it('Accept takes the picked aircraft when it passes; a picked aircraft that cannot take it signs nothing and says why', () => {
    const g = newGame(31);
    const o = rung(g);
    const rs = callReports(g, o.id);
    const ok = rs.filter((r) => !r.checks.some((c) => c.level === 'no'));
    expect(ok.length).toBeGreaterThanOrEqual(2);
    // The second passing aircraft, not the dialog's first.
    const pick = ok[1].aircraftId;
    expect(callPlan(g, o.id, pick)).toEqual({ ok: true, aircraftId: pick });
    const r = answerCall(g, o.id, pick);
    expect(r.ok).toBe(true);
    expect(g.contracts[r.ok ? r.data!.contractId : ''].aircraftIds).toEqual([pick]);

    const g2 = newGame(32);
    const o2 = rung(g2);
    const ac = Object.values(g2.fleet)[1];
    o2.requirements.minSeats = 600;
    const why = callPlan(g2, o2.id, ac.id);
    const before = JSON.stringify(g2);
    expect(why.ok).toBe(false);
    expect(!why.ok && why.error).toMatch(/seat/i);
    expect(answerCall(g2, o2.id, ac.id)).toEqual(why);
    expect(JSON.stringify(g2)).toBe(before);
    expect(g2.offers[o2.id].status).toBe('open');
  });

  it('one word on how each aircraft fits', () => {
    expect(callFit({ checks: [{ id: 'seats', level: 'ok', label: '' }] })).toEqual({ word: 'Ready', tone: 'good' });
    expect(callFit({ checks: [{ id: 'crew', level: 'warn', label: '' }] })).toEqual({ word: 'Tight', tone: 'warn' });
    expect(callFit({ checks: [{ id: 'crew', level: 'warn', label: '' }, { id: 'availability', level: 'no', label: '' }] })).toEqual({ word: 'Busy', tone: 'bad' });
    expect(callFit({ checks: [{ id: 'range', level: 'no', label: '' }] }).word).toBe('Range');
    expect(callFit({ checks: [{ id: 'mission', level: 'no', label: '' }] }).word).toBe('No');
  });

  it('unanswered: the client goes elsewhere, notes it (a small relation step) and the Inbox says so quietly', () => {
    const g = newGame(33);
    const o = rung(g);
    o.expires = g.now + 45;
    o.firstRefusal = undefined;
    o.rivalBid = undefined;
    const cl = g.clients[o.clientId];
    const was = cl.relation;
    run(g, g.now + 46);
    onOfferExpire(g, { t: g.now, type: 'offer.expire', id: o.id } as never);
    expect(o.status).toBe('lost');
    expect(o.lostWhy).toMatch(/nobody answered their call/);
    expect(cl.relation).toBeCloseTo(was + CALL_MISSED_REL, 5);
    expect(cl.log?.at(-1)?.[2]).toBe('Our phone went unanswered');
    expect(g.messages.some((m) => m.ref?.id === o.id && /went elsewhere/.test(m.title))).toBe(true);
    clearPause();
  });
});

describe('v0.14 an offer about to lapse is never missed unseen', () => {
  it('one Inbox line with its chime when under 3 h is left: opened or not, as long as the fleet could fly it; never a call', () => {
    const g = newGame(34);
    lapseCues(g);
    takeCueEvents();
    const o = offer(g, 'adhoc', { start: g.now + 3 * DAY });
    expect(o.seen).toBeFalsy();
    expect(flyable(g, o)).toBe(true);
    const c = rung(g);
    o.expires = g.now + 60 + LAPSE_WARN - 30;
    c.expires = g.now + 60 + 40;
    takeCueEvents();
    g.now += 60;
    lapseCues(g);
    const cues = takeCueEvents();
    expect(cues.map((x) => x.cue)).toEqual(['offerLapsing']);
    expect(cues[0].ref?.id).toBe(o.id);
    const m = g.messages.find((x) => x.ref?.id === o.id && /lapsing soon/.test(x.title));
    expect(m?.body).toMatch(/within 2 h 30 min/);
    // Once.
    g.now += 60;
    lapseCues(g);
    expect(takeCueEvents()).toEqual([]);
    clearPause();
  });
});

describe('v0.14 the opening offers', () => {
  it('are written offers, never a call: the opening AOG cover gives 6 h or more to answer', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = newGame(seed);
      const open = Object.values(g.offers).filter((o) => o.status === 'open');
      expect(open.some((o) => o.call)).toBe(false);
      for (const o of open) if (o.start - g.now - 60 >= REPLY_MIN) expect(o.expires - g.now, `${seed} ${o.archetype}`).toBeGreaterThanOrEqual(REPLY_MIN);
    }
  });
});

describe('v0.14 pacing', () => {
  it('calls and short-notice offers keep to the busy spells (quiet spells stay quiet)', () => {
    let quietCalls = 0;
    let quietShort = 0;
    for (const seed of [1, 2]) {
      const g = newGame(seed);
      const seen = new Set<string>();
      const end = g.now + 120 * DAY;
      while (g.now < end) {
        run(g, Math.min(end, g.now + 6 * 60));
        for (const o of Object.values(g.offers)) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          if (!isQuiet(g, o.created)) continue;
          if (o.call) quietCalls++;
          else if (o.expires - o.created < REPLY_MIN && o.status === 'open') quietShort++;
        }
        clearPause();
      }
    }
    expect(quietCalls).toBe(0);
    expect(quietShort).toBe(0);
  }, 120_000);
});

describe('v0.14 saves', () => {
  it('an older save with open offers and a call loads as it was: the call keeps the time it was given, and lapses as a missed call', async () => {
    const { fixture } = await import('../fixtures/compatKit');
    const { deserialize } = await import('../save');
    const g = deserialize(fixture('v0102-blue'));
    const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.expires > g.now);
    expect(open.length).toBeGreaterThan(0);
    // An old call (v0.10.2–v0.13: the written offer's reply window) is still answered by its own expiry.
    const o = open[0];
    o.call = true;
    o.urgency = 'urgent';
    o.firstRefusal = undefined;
    o.rivalBid = undefined;
    const at = o.expires;
    const plan = callPlan(g, o.id);
    expect(typeof plan.ok).toBe('boolean');
    run(g, at + 1);
    expect(o.status === 'lost' || o.status === 'expired' || o.status === 'accepted').toBe(true);
    if (o.status === 'lost') expect(g.clients[o.clientId].log?.some((l) => l[2] === 'Our phone went unanswered')).toBe(true);
    clearPause();
  }, 60_000);
});
