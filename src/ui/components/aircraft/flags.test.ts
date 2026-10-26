// The registration's flag: flat flag artwork for every registry state the game knows, painted as a 3:2 rectangle
// (square for Switzerland) at the registration's cap height, with a hairline only on light paint.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../../../data/countries';
import type { Livery } from '../../../engine/core/types';
import { flagCodes, flagRatio, flagUrl } from './flags';
import { extraDecals } from './stickers';

const svg = (code: string) => readFileSync(resolve(__dirname, '../../../../node_modules/country-flag-icons/3x2', `${code}.svg`), 'utf8');
const fills = (code: string) => new Set([...svg(code).matchAll(/fill="(#[0-9a-fA-F]{3,6}|red|white|blue)"/g)].map((m) => m[1].toLowerCase()));

describe('registration flags', () => {
  it('bundles exactly the registry states (no flag the game cannot use)', () => {
    const want = [...new Set(Object.values(COUNTRIES).filter((c) => c.reg).map((c) => c.code))].sort();
    expect(flagCodes()).toEqual(want);
    for (const c of want) expect(flagUrl(c), c).toMatch(/\.svg/);
    expect(flagUrl('XX')).toBe('');
  });

  it('the artwork is the flat flag in its colours, drawn 3:2', () => {
    for (const c of flagCodes()) {
      const [, w, h] = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg(c))!.map(Number);
      expect(w / h, c).toBeCloseTo(1.5, 2);
    }
    expect([...fills('PT')]).toEqual(expect.arrayContaining(['red', '#060', '#ff0']));
    expect([...fills('NL')]).toEqual(expect.arrayContaining(['#cd1f2a', '#fff', '#1d4185']));
    expect([...fills('ES')]).toEqual(expect.arrayContaining(['#d03433', '#fbca46']));
    expect([...fills('CH')]).toEqual(expect.arrayContaining(['red', '#fff']));
    expect(flagRatio('PT')).toBe(1.5);
    expect(flagRatio('CH')).toBe(1);
  });

  const white: Livery = { primary: '#ffffff', secondary: '#0b1f4d', tail: 'solid' };
  const dark: Livery = { primary: '#13294b', secondary: '#c8a24a', tail: 'solid', body: { color: '#13294b' } };
  const flagOf = (id: string, lv: Livery, reg: string) => extraDecals(id, lv, { reg, fine: true }).find((x) => x.id === 'flag');

  it('a flag decal is a rectangle at the registration cap height, coded by the registry state', () => {
    for (const [reg, code] of [['CS-TBL', 'PT'], ['PH-BXA', 'NL'], ['EC-MXV', 'ES'], ['HB-JNA', 'CH']] as const) {
      const all = extraDecals('a332', white, { reg, fine: true });
      const f = all.find((x) => x.id === 'flag')!, r = all.find((x) => x.id === 'reg')!;
      expect(f.kind, reg).toBe('flag');
      expect(f.text, reg).toBe(code);
      expect(f.h, reg).toBeCloseTo(r.h, 5);
      expect(f.w / f.h, reg).toBeCloseTo(flagRatio(code), 5);
      // clear of the registration
      expect(Math.abs(f.cx - r.cx), reg).toBeGreaterThan((f.w + r.w) / 2);
    }
    // an unknown prefix or the flag turned off: none
    expect(flagOf('a332', white, 'ZZ-ABC')).toBeUndefined();
    expect(flagOf('a332', { ...white, reg: { noFlag: true } }, 'CS-TBL')).toBeUndefined();
  });

  it('a hairline round the flag on light paint only', () => {
    for (const id of ['a320ceo', 'a332']) {
      const onWhite = flagOf(id, white, 'JA-801A'), onDark = flagOf(id, dark, 'JA-801A');
      if (onWhite) expect(onWhite.ink, id).toBeTruthy();
      if (onDark) expect(onDark.ink, id).toBeUndefined();
    }
    expect(flagOf('a332', white, 'JA-801A')).toBeTruthy();
  });
});
