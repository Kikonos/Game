// v0.25 commercial realism: offers that fit their clients and their dates.

import { describe, expect, it } from 'vitest';
import { newGame } from './testkit';
import { generateOffer } from './offers';
import { DAY, fromUTC, toDate } from '../core/time';
import { diasporaReasonsAt, DIASPORA_BY_CLIENT, DIASPORA_REASONS } from './flavor';
import { hajjDates } from '../../data/worldCalendar';
import type { GameState } from '../core/types';

const byName = (g: GameState, n: string) => Object.values(g.clients).find((c) => c.name === n);

describe('v0.25 named clients get the trips they do', () => {
  it('Shell, Siemens and Real Madrid never get a diaspora charter, even when asked for one', () => {
    const g = newGame();
    let seen = 0;
    for (const n of ['Shell', 'Siemens', 'Real Madrid', 'Novartis']) {
      const c = byName(g, n);
      if (!c) continue;
      for (let i = 0; i < 8; i++) {
        for (const variant of [undefined, 'diaspora', 'pilgrimage'] as const) {
          const o = generateOffer(g, 'adhoc', { client: c.id, window: false, ...(variant ? { variant } : {}) });
          if (!o) continue;
          seen++;
          expect(o.clientId).toBe(c.id);
          expect(o.title, `${n}: ${o.title}`).not.toMatch(/Diaspora|Pilgrimage/);
          delete g.offers[o.id];
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('v0.25 diaspora reasons fit the date', () => {
  const at = (y: number, m: number, d: number) => fromUTC(y, m, d);
  it('an August departure is never for Christmas, a December one never for the summer holidays', () => {
    const lists = [DIASPORA_REASONS, ...Object.values(DIASPORA_BY_CLIENT).map((x) => x.reasons)];
    for (const l of lists) {
      expect(diasporaReasonsAt(l, at(2027, 8, 2))).not.toContain('for Christmas and New Year');
      expect(diasporaReasonsAt(l, at(2027, 12, 18))).not.toContain('for the summer holidays');
    }
    expect(diasporaReasonsAt(DIASPORA_REASONS, at(2027, 12, 18))).toContain('for Christmas and New Year');
  });
  it('Eid only in the fortnight before Eid al-Fitr or Eid al-Adha', () => {
    const r = DIASPORA_BY_CLIENT.Corendon.reasons;
    const h = hajjDates(2027);
    expect(diasporaReasonsAt(r, h.arafah - 5 * DAY)).toContain('for Eid with their families');
    expect(diasporaReasonsAt(r, h.arafah - 60 * DAY)).not.toContain('for Eid with their families');
  });
  it('generated diaspora offers across the year never name a reason out of season', () => {
    const g = newGame();
    const c = Object.values(g.clients).find((x) => DIASPORA_BY_CLIENT[x.name]) ?? Object.values(g.clients).find((x) => /Diaspora/i.test(x.name));
    if (!c) return;
    let n = 0;
    for (let d = 5; d < 365; d += 9) {
      const o = generateOffer(g, 'adhoc', { client: c.id, window: false, variant: 'diaspora', start: g.now + d * DAY });
      if (!o) continue;
      n++;
      const m = toDate(o.start).getUTCMonth() + 1;
      if (m !== 12) expect(o.blurb).not.toMatch(/Christmas/);
      if (m < 6 || m > 8) expect(o.blurb).not.toMatch(/summer holidays/);
      delete g.offers[o.id];
    }
    expect(n).toBeGreaterThan(0);
  });
});
