// v0.14 the tender board's season line and the Tenders tab count; the Inbox and toast links for tenders and trips.

import { describe, expect, it } from 'vitest';
import { fromUTC } from '../../engine/core/time';
import { newGame } from '../../engine/contracts/testkit';
import { issueTender } from '../../engine/commercial';
import { refTarget } from './screenLogic';
import { openTenders, seasonLine } from './Tenders';

describe('tender board', () => {
  it('says which round is open, or when the next one opens', () => {
    expect(seasonLine(fromUTC(2027, 12, 1))).toMatch(/^Summer tender season: .*summer 2028/);
    expect(seasonLine(fromUTC(2027, 7, 1))).toMatch(/^Winter tender season/);
    expect(seasonLine(fromUTC(2027, 3, 10))).toMatch(/June to August/);
    expect(seasonLine(fromUTC(2027, 9, 10))).toMatch(/November to February/);
  });

  it('counts the open RFPs not bid yet; links lead to the board and to Team › Sales trips', () => {
    const g = newGame(61);
    expect(openTenders(g)).toBe(0);
    const t = issueTender(g) ?? issueTender(g)!;
    expect(openTenders(g)).toBe(1);
    expect(refTarget(g, { kind: 'tender', id: t.id })).toEqual({ tab: 'contracts', view: 'tenders', sel: { kind: 'tender', id: t.id } });
    expect(refTarget(g, { kind: 'trip', id: 'tp1' })).toEqual({ tab: 'company', view: 'team', sel: { kind: 'head', id: 'sales' } });
  });
});
