import { describe, expect, it } from 'vitest';
import { newGame } from '../../engine/contracts/testkit';
import { HOUR } from '../../engine/core/time';
import type { ReachSpec, TimelineSpec } from '../../engine/problems/types';
import { actionTarget, crewBanner, reachLayout, reachVerdict, termSegments, timelineLayout } from './problemLogic';

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
