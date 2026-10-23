// v0.9 sound cues (UPDATE-0.9.md §S.3): messages and decisions map to their cue, sources emit theirs once, previews
// (isolatePauses) emit none, and nothing about cues reaches a save.

import { describe, expect, it } from 'vitest';
import { generateOffer } from '../contracts';
import { lapseCues } from '../contracts/offers';
import { addFlight } from './entities';
import { blockMinutes } from './perf';
import { DAY } from './time';
import { fixtureContract, fixtureGame } from '../crew/fixtures';
import { delayFlight } from '../ops/flights';
import { serialize } from '../save';
import { CUES, cue, cueOfDecision, cueOfMessage, takeCues } from './cues';
import { pushDecision, pushMessage } from './messages';
import { clearPause, isolatePauses } from './pause';

describe('§S.3 cue tables', () => {
  it('every cue once; topics, problem kinds and tones map to the fixed meanings', () => {
    expect(new Set(CUES).size).toBe(CUES.length);
    expect(cueOfMessage({ topic: 'crewRed', tone: 'bad', cat: 'crew' })).toBe('crewShortage');
    expect(cueOfMessage({ topic: 'crewHours', tone: 'bad', cat: 'crew' })).toBe('crewOutOfHours');
    expect(cueOfMessage({ topic: 'achievement', tone: 'good', cat: 'company' })).toBe('achievement');
    expect(cueOfMessage({ topic: 'ladder', tone: 'good', cat: 'company' })).toBe('ladder');
    expect(cueOfMessage({ topic: 'head', tone: 'info', cat: 'company' })).toBe('headDone');
    expect(cueOfMessage({ topic: 'market', tone: 'info', cat: 'company' })).toBeNull();
    expect(cueOfMessage({ topic: 'world', tone: 'warn', cat: 'ops' })).toBeNull();
    expect(cueOfMessage({ tone: 'bad', cat: 'tech', problem: { kind: 'aog', ref: { kind: 'aircraft', id: 'a' } } })).toBe('aog');
    expect(cueOfMessage({ tone: 'bad', cat: 'crew', problem: { kind: 'crewSick', ref: { kind: 'flight', id: 'f' } } })).toBe('sickCall');
    expect(cueOfMessage({ tone: 'info', cat: 'ops' })).toBe('message');
    expect(cueOfDecision({ kind: 'rescue' })).toBe('cashNegative');
    expect(cueOfDecision({ kind: 'latePayment' })).toBe('latePayer');
    expect(cueOfDecision({ kind: 'changeRequest' })).toBe('decision');
  });

  it('pushMessage emits the mapped cue, an override, or nothing (cue: null); a decision its own', () => {
    const g = fixtureGame(61);
    takeCues();
    pushMessage(g, { tone: 'info', cat: 'ops', title: 'Routine', body: '' });
    pushMessage(g, { tone: 'good', cat: 'crew', title: 'Joined', body: '', cue: 'crewJoined' });
    pushMessage(g, { tone: 'info', cat: 'ops', title: 'Quiet', body: '', cue: null });
    pushDecision(g, { kind: 'sickCrew', title: 'Sick', body: '', options: [{ id: 'callIn', label: 'Call in', desc: '' }], defaultOption: 'callIn', expires: g.now + DAY, data: { flightId: 'none' } });
    expect(takeCues()).toEqual(['message', 'crewJoined', 'sickCall']);
    clearPause();
  });
});

describe('§S.3 previews and saves', () => {
  it('previews on copies emit no cue and keep the pending ones; a save carries no cue', () => {
    const g = fixtureGame(62);
    takeCues();
    cue('paymentIn');
    isolatePauses(() => {
      pushMessage(g, { tone: 'info', cat: 'ops', title: 'Preview', body: '', cue: 'aog' });
      generateOffer(g);
    });
    expect(takeCues()).toEqual(['paymentIn']);
    pushMessage(g, { tone: 'good', cat: 'crew', title: 'Joined', body: '', cue: 'crewJoined' });
    const s = serialize(g);
    expect(s).not.toMatch(/"cue"/);
    expect(s).not.toMatch(/crewJoined/);
    clearPause();
  });
});

describe('§S.3 sources', () => {
  it('a new offer chimes; an opened offer with under 6 h left chimes once', () => {
    const g = fixtureGame(63);
    lapseCues(g);
    takeCues();
    let o = generateOffer(g, 'adhoc');
    for (let i = 0; i < 20 && !o; i++) o = generateOffer(g);
    expect(o).toBeTruthy();
    if (!o) return;
    const c = takeCues();
    expect(c.some((x) => x === 'offerNew' || x === 'evacuation')).toBe(true);
    o.seen = true;
    o.status = 'open';
    o.expires = g.now + 5 * 60 + 30;
    g.now += 60;
    lapseCues(g);
    expect(takeCues()).toEqual(['offerLapsing']);
    g.now += 60;
    lapseCues(g);
    expect(takeCues()).toEqual([]);
    clearPause();
  });

  it('a charter leg passing 60 min late with a penalty chimes delayPenalty once; past 6 h, cancelRisk', () => {
    const g = fixtureGame(64);
    const acId = Object.keys(g.fleet)[0];
    const ac = g.fleet[acId];
    ac.at = 'LIS';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
    const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
    const f = addFlight(g, { no: 'AW950', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
    takeCues();
    delayFlight(g, f.id, 30, 'Technical: APU');
    expect(takeCues()).not.toContain('delayPenalty');
    delayFlight(g, f.id, 40, 'Technical: APU');
    expect(takeCues()).toContain('delayPenalty');
    delayFlight(g, f.id, 30, 'Technical: APU');
    expect(takeCues()).not.toContain('delayPenalty');
    delayFlight(g, f.id, 5 * 60, 'Technical: APU');
    expect(takeCues()).toContain('cancelRisk');
    clearPause();
  });
});
