// v0.25 review: national teams fly to the other home nations (the RFU to Murrayfield) and only in their sport's months
// (no 'Six Nations away' in August, no 'Nations League' outside the international windows).

import { describe, expect, it } from 'vitest';
import { newGame } from './testkit';
import { generateOffer } from './offers';
import { DAY, toDate } from '../core/time';
import { NATIONAL_MONTHS, nationalTitles, nationOf } from './flavor';
import { AIRPORT_BY_CODE } from '../../data/airports';
import type { GameState } from '../core/types';

const byName = (g: GameState, n: string) => Object.values(g.clients).find((c) => c.name === n);

describe('v0.25 national teams: home nations and the calendar', () => {
  it('England, Scotland, Wales and Northern Ireland are separate nations; in rugby Ireland is one island', () => {
    expect(nationOf('LHR', 'GB', true)).toBe('GB-ENG');
    expect(nationOf('EDI', 'GB', true)).toBe('GB-SCO');
    expect(nationOf('CWL', 'GB', false)).toBe('GB-WAL');
    expect(nationOf('BFS', 'GB', false)).toBe('GB-NIR');
    expect(nationOf('BFS', 'GB', true)).toBe('IE');
    expect(nationOf('DUB', 'IE', true)).toBe('IE');
  });
  it('titles fit the month', () => {
    expect(nationalTitles('rugby', 7)).toEqual(['Test match in']);
    expect(nationalTitles('rugby', 1)).toEqual(['Six Nations away in']);
    expect(nationalTitles('football', 7)).toEqual(['Friendly in']);
    expect(nationalTitles('football', 9)).toContain('Nations League away in');
    expect(nationalTitles('football', 5)).not.toContain('Nations League away in');
  });
  it('the RFU can fly to Murrayfield; every drawn trip falls in its sport\'s months', () => {
    const g = newGame(5);
    const rfu = byName(g, 'Rugby Football Union (RFU)');
    const fa = byName(g, 'The Football Association (FA)');
    expect(rfu && fa).toBeTruthy();
    const dests = new Set<string>();
    let n = 0;
    for (const [c, sport] of [[rfu!, 'rugby'], [fa!, 'football']] as const) {
      for (let i = 0; i < 40; i++) {
        const o = generateOffer(g, 'sports', { client: c.id, window: false, wide: false });
        g.now += 3 * DAY;
        if (!o || o.pattern.kind !== 'legs') continue;
        n++;
        const leg = o.pattern.legs[0];
        const month = toDate(o.pattern.legs[1].dep).getUTCMonth();
        expect(NATIONAL_MONTHS[sport], `${o.title} ${toDate(leg.dep).toISOString()}`).toContain(month);
        if (/Six Nations/.test(o.title)) expect([1, 2]).toContain(month);
        if (c === rfu) dests.add(leg.to);
        expect(AIRPORT_BY_CODE[leg.to]).toBeTruthy();
        delete g.offers[o.id];
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(dests.has('EDI')).toBe(true);
  });
});
