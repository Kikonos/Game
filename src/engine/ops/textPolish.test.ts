// v0.25 text polish: result lines end with one stop; every home base has its authority named.
import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { AUTHORITY } from '../../data/flavor';
import { HOME_BASES } from '../../data/naming';
import { endMsg } from './events';

describe('text polish', () => {
  it('a result line ends with exactly one stop', () => {
    expect(endMsg('Avion Express flies 3 legs for us.')).toBe(' Avion Express flies 3 legs for us.');
    expect(endMsg('Done')).toBe(' Done.');
    expect(endMsg(undefined)).toBe('');
  });
  it('every home base country names its aviation authority', () => {
    for (const b of HOME_BASES) expect(AUTHORITY[AIRPORT_BY_CODE[b].country], b).toBeTruthy();
  });
});
