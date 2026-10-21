import { describe, expect, it } from 'vitest';
import { newGame } from '../../engine/contracts/testkit';
import { HOUR } from '../../engine/core/time';
import type { ReachSpec, TimelineSpec } from '../../engine/problems/types';
import { actionTarget, crewBanner, decisionBodyTail, moreReasons, reachLayout, reachLimited, reachTone, reachVerdict, restNow, termSegments, timelineLayout } from './problemLogic';

describe('glossary wrapping', () => {
  it('wraps whole words once, longest first, case-insensitively', () => {
    const segs = termSegments('The FDP runs long after the deadhead; a rest in a restaurant is no rest.');
    expect(segs.filter((s) => s.term).map((s) => [s.text, s.term])).toEqual([['FDP', 'fdp'], ['deadhead', 'deadhead'], ['rest', 'rest']]);
    expect(segs.map((s) => s.text).join('')).toBe('The FDP runs long after the deadhead; a rest in a restaurant is no rest.');
  });
  it('prefers the longer phrase and honours the card terms list', () => {
    expect(termSegments('after a weekly rest').find((s) => s.term)?.term).toBe('recovery');
    expect(termSegments('after a weekly rest', ['rest']).find((s) => s.term)?.term).toBe('rest');
    expect(termSegments('nothing here')).toEqual([{ text: 'nothing here' }]);
  });
});

const spec: ReachSpec = { from: 'LIS', to: 'DUS', now: 0, mustLandBy: 8 * HOUR, report: 9 * HOUR, departure: 10 * HOUR, earliestArrival: 11 * HOUR, legs: [{ no: 'TP 1342', airline: 'TAP', from: 'LIS', to: 'DUS', dep: 7 * HOUR, arr: 11 * HOUR }], gapMin: 3 * HOUR };

describe('reach bar', () => {
  it('orders the ticks in time, alternates the rows and draws the gap in red', () => {
    const lay = reachLayout(spec);
    expect(lay.ticks.map((t) => t.key)).toEqual(['now', 'must', 'report', 'dep', 'arr']);
    expect(lay.ticks.map((t) => t.side)).toEqual(['above', 'below', 'above', 'below', 'above']);
    expect(lay.gap).not.toBeNull();
    expect(lay.gap!.x1).toBeGreaterThan(lay.gap!.x0);
    for (const t of lay.ticks) expect(t.x).toBeGreaterThanOrEqual(0);
    expect(reachVerdict(spec)).toBe('The earliest flight lands 3 h too late');
    expect(reachVerdict({ ...spec, earliestArrival: 7 * HOUR + 20, gapMin: -40 })).toBe('The earliest flight lands with 40 min to spare');
    expect(reachLayout({ ...spec, gapMin: -40 }).gap).toBeNull();
  });
  it('lays a timeline out on the same scale', () => {
    const tl: TimelineSpec = { from: 0, to: 600, marks: [{ t: 0, label: 'Fault' }, { t: 540, label: 'Repaired', tone: 'good' }], spans: [{ from: 0, to: 540, label: 'Repair', tone: 'bad' }] };
    const lay = timelineLayout(tl);
    expect(lay.ticks).toHaveLength(2);
    expect(lay.spans[0].x1).toBeGreaterThan(lay.spans[0].x0);
  });
});

describe('card actions and banners', () => {
  it('maps modal actions to our modal specs and tabs', () => {
    const g = newGame();
    expect(actionTarget(g, { id: 'cc', label: 'x', open: { modal: 'crewControl', id: 'f1' } })).toEqual({ modal: { kind: 'crewControl', flightId: 'f1' } });
    expect(actionTarget(g, { id: 'h', label: 'x', open: { modal: 'hire', id: 'CPT' } })).toEqual({ modal: { kind: 'hire', role: 'CPT' } });
    expect(actionTarget(g, { id: 'h', label: 'x', open: { modal: 'hire', id: 'A330/340' } })).toEqual({ modal: { kind: 'hire', family: 'A330/340' } });
    expect(actionTarget(g, { id: 's', label: 'x', open: { tab: 'finance' } })).toEqual({ nav: { tab: 'finance', view: undefined, sel: undefined } });
    expect(actionTarget(g, { id: 's', label: 'x', open: { modal: 'subcharter', id: 'nope' } })).toBeNull();
    expect(actionTarget(g, { id: 'd', label: 'x', open: { modal: 'decision', id: 'gone' } })).toEqual({ nav: { tab: 'inbox' } });
  });
  it('tones the CREW SHORTAGE banner by the ladder stage', () => {
    expect(crewBanner(undefined, 30)).toBeNull();
    expect(crewBanner('amber', 30)).toBe('amber');
    expect(crewBanner('amber', 10)).toBe('red');
    expect(crewBanner('red', 30)).toBe('red');
  });
});

describe('v0.7.1 fix round 1: plain-language helpers', () => {
  const reach: ReachSpec = { from: 'LIS', to: 'DUS', now: 0, mustLandBy: 6 * HOUR, report: 7 * HOUR, departure: 8 * HOUR, earliestArrival: 5 * HOUR + 15, legs: [{ no: 'TP 1342', airline: 'TAP', from: 'LIS', to: 'DUS', dep: 2 * HOUR, arr: 5 * HOUR + 15 }], gapMin: -45 };
  it('reads amber, not green, when the ride lands in time but the day would run too long', () => {
    expect(reachVerdict(reach)).toBe('The earliest flight lands with 45 min to spare');
    expect(reachVerdict(reach, true)).toBe('The earliest flight lands with 45 min to spare, but the day would then run too long');
    expect(reachTone(reach, true)).toBe('warn');
    expect(reachTone({ ...reach, gapMin: 30 }, true)).toBe('bad');
    expect(reachLimited({ why: 'Your free captains are in Lisbon: flown in the same day their day would be too long, and after a night\'s rest they report too late.', terms: ['deadhead'] })).toBe(true);
    expect(reachLimited({ why: 'Your free captains are in Lisbon and the earliest they can land is 11:40.', terms: ['deadhead'] })).toBe(false);
  });
  it('keeps only the tail of a decision body the card already tells', () => {
    const card = { what: 'LO5102 has no pilots', why: 'Your free captains are in Lisbon.', hurt: { text: 'Yes: 306 passengers' } } as never as Parameters<typeof decisionBodyTail>[1];
    expect(decisionBodyTail('LO5102 has no pilots. Your free captains are in Lisbon. Yes: 306 passengers. It has been waiting 2h 00m at Warsaw.', card)).toBe('It has been waiting 2h 00m at Warsaw.');
    expect(decisionBodyTail('LO5102 has been waiting 2h at Warsaw: no legal CPT can take it.', card)).toBe('LO5102 has been waiting 2h at Warsaw: no legal CPT can take it.');
    expect(decisionBodyTail('anything', null)).toBe('anything');
  });
  it('shows one reason per person: a single location line, nothing the root cause already says', () => {
    const busy = { code: 'busy' as const, text: 'busy on DE3000 to Budapest until 16:50', all: ['On another trip until 28 Apr', 'Overlaps another duty', 'At VCE, not CMN', 'At CMN, not LIS', 'Short of rest (8:00 of 10:00)'] };
    expect(moreReasons(busy)).toEqual(['Short of rest (8:00 of 10:00)']);
    const place = { code: 'place' as const, text: 'in Venice, landing 11:40 at the earliest', all: ['At VCE, not CMN', 'At CMN, not LIS', 'FDP 12:10 > 11:00'] };
    expect(moreReasons(place)).toEqual(['FDP 12:10 > 11:00']);
    const rest = { code: 'rest' as const, text: 'resting until 09:10', all: ['Rest 7:30 of 10:00', 'At VCE, not CMN', 'At CMN, not LIS', 'At VCE, not CMN'] };
    expect(moreReasons(rest)).toEqual(['Rest 7:30 of 10:00', 'At VCE, not CMN']);
  });
  it('measures the rest gauge now on the crew card, dropping the by once complete', () => {
    const spec = { id: 'rest' as const, label: 'Rest', value: 600, limit: 600, unit: 'hm' as const, text: '10:00 of 10:00', tone: 'good' as const, by: 150 };
    const resting = restNow(spec, 0);
    expect(resting.text).toBe('7:30 of 10:00 by 02:30');
    expect(resting.tone).toBe('warn');
    expect(resting.value).toBe(450);
    expect(restNow(spec, 200)).toMatchObject({ text: '10:00 of 10:00', tone: 'good', by: undefined });
    expect(restNow({ ...spec, value: 120, text: '2:00 of 10:00', tone: 'bad' }, 0)).toMatchObject({ text: '7:30 of 10:00 by 02:30', tone: 'warn' });
    // a rest between two later duties has not started: left as planned
    expect(restNow({ ...spec, by: 2000 }, 0)).toMatchObject({ by: 2000, text: '10:00 of 10:00' });
    expect(restNow({ ...spec, id: 'fdp' }, 0).text).toBe('10:00 of 10:00');
  });
  it('sends every glossary Show me to a view the screen knows, in its own words', async () => {
    const { glossaryTarget, KNOWN_VIEWS } = await import('./problemLogic');
    const { GLOSSARY } = await import('../../data/glossary');
    for (const e of Object.values(GLOSSARY)) {
      if (!e.where) continue;
      const t = glossaryTarget(e.where);
      if (t.view) expect(KNOWN_VIEWS[t.tab]).toContain(t.view);
      expect(t.label).not.toMatch(/roster$|policies$/);
    }
    expect(glossaryTarget({ tab: 'crew', view: 'roster' })).toEqual({ tab: 'crew', view: 'board', label: 'Crew › Roster board' });
    expect(glossaryTarget({ tab: 'crew', view: 'policies' })).toEqual({ tab: 'company', view: undefined, label: 'Company › Policies' });
    expect(glossaryTarget({ tab: 'map' })).toEqual({ tab: 'map', view: undefined, label: 'Ops Map' });
  });
});
