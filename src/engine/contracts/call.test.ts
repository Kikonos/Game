// v0.10.2 the phone call (contracts/call.ts): the trigger is urgent AND high-paying; answering and declining run the
// offer dialog's own engine actions; a blocked call accepts nothing and says why.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { takeCueEvents } from '../core/cues';
import { DAY } from '../core/time';
import type { ContractOffer, GameState } from '../core/types';
import { offerExtra } from '../crew/extraSeats';
import { acceptOffer, declineOffer } from './accept';
import { COUNTRIES } from '../../data/countries';
import { kitsFor, NAMES } from '../../data/names';
import { answerCall, CALL_MARGIN_X, callPlan, callScore, callScript, contactOf, declineCall, isCallOffer } from './call';
import { feasibilityAll } from './feasibility';
import { generateOffer } from './offers';
import { newGame, offer } from './testkit';

/** An AOG-cover wet lease (an urgent kind of job) starting in a day, at `x` × the A320's standard ACMI rate. */
function aogCover(g: GameState, x: number): ContractOffer {
  const o = offer(g, 'aogCover', { start: g.now + DAY });
  o.urgency = 'urgent';
  if (o.product.kind === 'wet') o.product.ratePerBH = Math.round(ACMI_TYPES.a320ceo.rateBH * x);
  return o;
}

describe('the phone call (v0.10.2)', () => {
  it('rings only when urgent AND high-paying', () => {
    const g = newGame(21);
    const rich = aogCover(g, 4);
    expect(callScore(g, rich)).toBeGreaterThanOrEqual(CALL_MARGIN_X);
    expect(isCallOffer(g, rich)).toBe(true);
    // The same money with more time to answer: an ordinary offer.
    rich.urgency = 'short';
    expect(isCallOffer(g, rich)).toBe(false);
    // Urgent at about the usual rate: the HI-LO chime, not a call.
    const plain = aogCover(newGame(21), 1);
    expect(callScore(newGame(21), plain)).toBeLessThan(CALL_MARGIN_X);
  });

  it('the generator rings urgent high-paying work as a call (cue and Inbox line), other urgent work with the usual note', () => {
    let calls = 0;
    let plain = 0;
    for (let seed = 1; seed <= 30 && (!calls || !plain); seed++) {
      const g = newGame(seed);
      takeCueEvents();
      const o = generateOffer(g, 'evacuation', { start: g.now + 30 * 60 + 24 * 60, wide: false, window: false, paint: false, cabin: false });
      if (!o || o.urgency !== 'urgent') continue;
      const cues = takeCueEvents();
      const msg = g.messages.find((m) => m.ref?.kind === 'offer' && m.ref.id === o.id);
      if (o.call) {
        calls++;
        expect(isCallOffer(g, o)).toBe(true);
        expect(msg?.title).toBe(`Phone call: ${o.title}`);
        expect(cues.some((c) => c.cue === 'offerCall' && c.ref?.id === o.id)).toBe(true);
      } else if (msg) {
        plain++;
        expect(msg.title).toBe(`Urgent: ${o.title}`);
        expect(cues.some((c) => c.cue === 'offerCall')).toBe(false);
      }
    }
    expect(calls).toBeGreaterThan(0);
  });

  it('Accept runs the offer dialog\'s accept: the first aircraft that passes, the default options, acceptOffer', () => {
    const g = newGame(22);
    const o = aogCover(g, 4);
    const twin = structuredClone(g);
    const plan = callPlan(g, o.id);
    expect(plan.ok).toBe(true);
    // The dialog's way, on a copy: its first report with no red check, paint/cabin on when asked, default extra crew.
    const sel = feasibilityAll(twin, o.id, { paint: !!o.paint, cabin: !!o.cabin }).find((r) => !r.checks.some((c) => c.level === 'no'))!;
    expect(plan.ok && plan.aircraftId).toBe(sel.aircraftId);
    const want = acceptOffer(twin, o.id, [sel.aircraftId], { paint: !!o.paint, cabin: !!o.cabin, crewExtra: offerExtra(twin, sel.aircraftId, o.requirements) });
    const got = answerCall(g, o.id);
    expect(got.ok).toBe(true);
    expect(want.ok).toBe(true);
    expect(JSON.stringify(g)).toBe(JSON.stringify(twin));
    // Answered: the offer is gone from the market; a second answer is refused.
    expect(answerCall(g, o.id).ok).toBe(false);
  });

  it('a blocked call accepts nothing and says why', () => {
    const g = newGame(23);
    const o = aogCover(g, 4);
    o.requirements.minSeats = 600;
    const before = JSON.stringify(g);
    const r = answerCall(g, o.id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.length).toBeGreaterThan(0);
    expect(callPlan(g, o.id)).toEqual(r);
    expect(JSON.stringify(g)).toBe(before);
    expect(g.offers[o.id].status).toBe('open');
  });

  it('Decline is the normal decline', () => {
    const g = newGame(24);
    const o = aogCover(g, 4);
    const twin = structuredClone(g);
    expect(declineCall(g, o.id)).toEqual(declineOffer(twin, o.id));
    expect(JSON.stringify(g)).toBe(JSON.stringify(twin));
  });

  it('the script: the client and a contact, a spoken line, the first departure', () => {
    const g = newGame(25);
    const o = aogCover(g, 4);
    const s = callScript(g, o.id)!;
    expect(s.caller).toBe(o.broker ? `${o.broker} for ${g.clients[o.clientId].name}` : g.clients[o.clientId].name);
    expect(s.person).toMatch(/^\S+ \S+/);
    expect(s.line).toMatch(/\?/);
    expect(s.seats).toBeGreaterThan(0);
    // The same person every time this client calls.
    expect(callScript(g, o.id)!.person).toBe(s.person);
  });

  it('every client gets a caller named from its own country (Belgium Dutch or French, never a stray Portuguese)', () => {
    // Every country in the game can field a caller.
    for (const c of Object.keys(COUNTRIES)) {
      const kits = kitsFor(c);
      expect(kits.length, c).toBeGreaterThan(0);
      for (const k of kits) expect(NAMES[k], `${c} → ${k}`).toBeTruthy();
    }
    const fromKit = (name: string, country: string) => kitsFor(country).some((k) => {
      const kit = NAMES[k];
      const [a, ...rest] = name.split(' ');
      // Family name first or last; first names can be two words ('Juan Pablo', 'Mei Ling').
      const parts = kit.familyFirst ? [rest.join(' '), a] : (() => {
        for (const l of [...kit.last, ...(kit.lastF ?? [])]) if (name.endsWith(` ${l}`)) return [name.slice(0, -l.length - 1), l];
        return [a, rest.join(' ')];
      })();
      return [...kit.f, ...kit.m].includes(parts[0]) && [...kit.last, ...(kit.lastF ?? [])].includes(parts[1]);
    });
    const g = newGame(25);
    const clients = Object.values(g.clients);
    expect(clients.length).toBeGreaterThan(50);
    for (const cl of clients) {
      const name = contactOf(`client:${cl.id}`, cl.country);
      expect(fromKit(name, cl.country), `${cl.name} (${cl.country}): ${name}`).toBe(true);
      // Deterministic: the same client, the same caller.
      expect(contactOf(`client:${cl.id}`, cl.country)).toBe(name);
    }
    // The script uses the client's country.
    const o = aogCover(g, 4);
    o.broker = undefined;
    const be = clients.find((c) => c.country === 'BE')!;
    o.clientId = be.id;
    const p = callScript(g, o.id)!.person;
    expect(fromKit(p, 'BE')).toBe(true);
    // Belgium draws from both its languages across clients.
    const be100 = Array.from({ length: 60 }, (_, i) => contactOf(`client:x${i}`, 'BE'));
    expect(be100.some((n) => fromKit(n, 'BE') && NAMES['BE-fr'].last.some((l) => n.endsWith(l)))).toBe(true);
    expect(be100.some((n) => NAMES['BE-nl'].last.some((l) => n.endsWith(l)))).toBe(true);
  });
});
