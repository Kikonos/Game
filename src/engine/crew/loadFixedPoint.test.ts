// v0.25 core-4: loading an old save was not a fixed point. Fixture v08 (before the v0.9 day plan) got its days off and
// standby only on a second load; v0.16.2's HX6001 had two standby windows marked called only on a second load. Pinned:
// load, save and load again changes nothing more.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize, serialize } from '../save';

const strip = (s: string): unknown => {
  const o = JSON.parse(s) as { meta?: { savedAt?: unknown } };
  delete o.meta?.savedAt;
  return o;
};

describe('a loaded save is a fixed point', () => {
  for (const name of ['v08', 'v0162-hx6001']) {
    it(`fixture ${name}: load(save(load(x))) saves as load(x)`, () => {
      const once = serialize(deserialize(fixture(name)));
      const twice = serialize(deserialize(once));
      expect(strip(twice)).toEqual(strip(once));
    });
  }
  it('fixture v08: crew have days off on the first load', () => {
    const g = deserialize(fixture('v08'));
    const crew = Object.values(g.crew).filter((c) => c.status !== 'joining');
    expect(crew.filter((c) => c.off?.length).length).toBeGreaterThan(crew.length / 2);
  });
});
