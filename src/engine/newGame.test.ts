// New game options: every offered home base starts a consistent company there.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../data/airports';
import { COUNTRIES } from '../data/countries';
import { HOME_BASE_NOTES, HOME_BASES } from '../data/naming';
import { NAMES } from '../data/names';
import { feasibilityAll } from './contracts';
import { createGame, isHomeBase } from './newGame';
import { advanceTo } from './sim';
import { DAY } from './core/time';

const livery = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' as const };

describe('new game options', () => {
  it.each(HOME_BASES)('starts at %s with fleet, crew, registry and offers there', (base) => {
    const g = createGame({ name: '  Test  Air ', code: 'ta', livery, base, seed: 3 });
    expect(g.company.homeBase).toBe(base);
    expect(g.company.name).toBe('Test Air');
    expect(g.company.code).toBe('TA');
    expect(HOME_BASE_NOTES[base]).toBeTruthy();
    const prefix = COUNTRIES[AIRPORT_BY_CODE[base].country].reg;
    expect(g.company.regPrefix).toBe(prefix);
    for (const ac of Object.values(g.fleet)) {
      expect(ac.at).toBe(base);
      expect(ac.reg.startsWith(prefix)).toBe(true);
    }
    const crew = Object.values(g.crew);
    expect(crew.length).toBe(60);
    for (const c of crew) {
      expect(c.base).toBe(base);
      expect(c.loc).toBe(base);
      expect(NAMES[c.nationality]).toBeTruthy();
    }
    // The opening offers exist and positioning is planned from the base.
    const offers = Object.values(g.offers);
    expect(offers.length).toBeGreaterThanOrEqual(3);
    for (const o of offers) {
      for (const r of feasibilityAll(g, o.id)) {
        if (r.positionIn.length) expect(r.positionIn[0].from).toBe(base);
      }
    }
    advanceTo(g, g.now + 3 * DAY);
    expect(Number.isFinite(g.company.cash)).toBe(true);
  });

  it('falls back to Lisbon for an unknown base and keeps the five brief bases', () => {
    expect(createGame({ name: 'X', code: 'XX', livery, base: 'ZZZ', seed: 1 }).company.homeBase).toBe('LIS');
    for (const b of ['LIS', 'VNO', 'MLA', 'MAD', 'RIX']) expect(isHomeBase(b)).toBe(true);
    expect(HOME_BASES[0]).toBe('LIS');
  });

  it('uses feminine surname forms where the language has them', () => {
    const g = createGame({ name: 'Riga Test', code: 'RT', livery, base: 'RIX', seed: 8 });
    const lv = Object.values(g.crew).filter((c) => c.nationality === 'LV');
    const kit = NAMES.LV;
    for (const c of lv) {
      const female = kit.f.includes(c.first);
      if (female) expect(kit.lastF).toContain(c.last);
      else expect(kit.last).toContain(c.last);
    }
  });
});

describe('opening offers', () => {
  it('are all flyable by the starting fleet (40 seeds at Lisbon)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = createGame({ name: 'Test Air', code: 'TA', livery, base: 'LIS', seed });
      const offers = Object.values(g.offers);
      expect(offers.length).toBeGreaterThanOrEqual(2);
      for (const o of offers) expect(feasibilityAll(g, o.id).some((r) => r.level !== 'no'), `seed ${seed}: ${o.title}`).toBe(true);
    }
  }, 60_000);
});
