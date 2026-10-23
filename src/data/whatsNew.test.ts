import { describe, expect, it } from 'vitest';
import { CURRENT, unseenEntries, whatsNewToShow } from './whatsNew';

const v = (xs: { version: string }[]) => xs.map((e) => e.version);

describe("v0.9 What's new catch-up (UPDATE-0.9.md §X)", () => {
  it('first v0.9 launch shows v0.9, v0.8 and v0.7.4 even when v0.8 was seen; then the normal rule', () => {
    expect(CURRENT.version).toBe('v0.9');
    expect(v(whatsNewToShow('v0.8', false))).toEqual(['v0.9', 'v0.8', 'v0.7.4']);
    expect(v(whatsNewToShow('v0.8', true))).toEqual(['v0.9']);
    expect(whatsNewToShow('v0.9', true)).toEqual([]);
    expect(v(whatsNewToShow('v0.7.4', false))).toEqual(['v0.9', 'v0.8', 'v0.7.4']);
  });
  it('a fresh install gets the newest only; an older player everything since their version', () => {
    expect(whatsNewToShow('', false)).toEqual([CURRENT]);
    expect(v(whatsNewToShow('v0.7.2', false))).toEqual(['v0.9', 'v0.8', 'v0.7.4', 'v0.7.3', 'v0.7.2.2', 'v0.7.2.1']);
    expect(whatsNewToShow('v0.7.2', true)).toEqual(unseenEntries('v0.7.2'));
  });
});
