import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AircraftArt, artGeometry, artViewBox } from './AircraftArt';
import { artRest, restGlyphs } from './restGlyph';

const LV = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' as const };
/** Glyph centre as [share of the fuselage from the nose, height above the centreline (m)]. */
const spot = (typeId: string, b: { x: number; y: number; w: number; h: number }): [number, number] => {
  const g = artGeometry(typeId);
  return [(-(b.x + b.w / 2) - g.tip[0]) / g.L, -(b.y + b.h / 2)];
};

describe('v0.7.3 crew rest glyphs', () => {
  it('puts the 777 bunks forward and aft overhead, above the windows', () => {
    const gs = restGlyphs('b77w', { fc: 'fcrc', cc: 'ccrc' });
    expect(gs.map((x) => x.kind)).toEqual(['bunk', 'bunk']);
    const g = artGeometry('b77w');
    const win = g.p.windows[0].y;
    const [a, ya] = spot('b77w', gs[0]);
    const [b, yb] = spot('b77w', gs[1]);
    expect(a).toBeCloseTo(0.12, 2);
    expect(b).toBeCloseTo(0.78, 2);
    for (const [s, y] of [[a, ya], [b, yb]]) {
      expect(y).toBeGreaterThan(win);
      expect(y).toBeLessThan(g.upperY(g.tip[0] + s * g.L));
    }
  });

  it('puts the A330 lower-deck module aft in the belly and its bunks behind the cockpit', () => {
    const g = artGeometry('a332');
    const [ld] = restGlyphs('a332', { fc: null, cc: 'ldmcr' });
    const [s, y] = spot('a332', ld);
    // 0.62 or just aft of the drawn wing, never further than 0.72
    expect(s).toBeGreaterThanOrEqual(0.62);
    expect(s).toBeLessThanOrEqual(0.72 + 1e-6);
    expect(y).toBeLessThan(g.p.windows[0].y - 0.5);
    expect(y).toBeGreaterThan(g.lowerY(g.tip[0] + s * g.L));
    const [fc] = restGlyphs('a332', { fc: 'fcrc', cc: null });
    expect(spot('a332', fc)[0]).toBeCloseTo(0.10, 2);
    expect(spot('a332', fc)[1]).toBeGreaterThan(g.p.windows[0].y);
  });

  it('draws business seats once as a block on the window line, recliners as a small seat aft', () => {
    const js = restGlyphs('a333', { fc: 'jSeats', cc: 'jSeats' });
    expect(js).toHaveLength(1);
    expect(js[0].kind).toBe('seats');
    const g = artGeometry('a333');
    expect(js[0].w).toBeCloseTo(0.1 * g.L, 1);
    const [rc] = restGlyphs('a321neo', { fc: 'recliners', cc: 'recliners' });
    expect(rc.kind).toBe('recliner');
    expect(spot('a321neo', rc)[0]).toBeCloseTo(0.86, 2);
  });

  it('keeps every glyph inside the viewBox for every widebody combination', () => {
    for (const id of ['b763', 'a332', 'a333', 'a343', 'b772', 'b77w', 'b77l', 'b789', 'a359', 'a35u', 'a388', 'b744', 'a321neo', 'b752']) {
      const vb = artViewBox(id);
      for (const r of [{ fc: 'fcrc', cc: 'ccrc' }, { fc: 'fcrc', cc: 'ldmcr' }, { fc: 'jSeats', cc: 'recliners' }] as const) {
        for (const b of restGlyphs(id, r)) {
          expect(b.x).toBeGreaterThanOrEqual(vb.x);
          expect(b.x + b.w).toBeLessThanOrEqual(vb.x + vb.w);
          expect(b.y).toBeGreaterThanOrEqual(vb.y);
          expect(b.y + b.h).toBeLessThanOrEqual(vb.y + vb.h);
        }
      }
    }
    expect(restGlyphs('a320ceo', { fc: null, cc: null })).toEqual([]);
  });

  it('shares one rest prop object per kind pair, none for no rest', () => {
    expect(artRest({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: null })).toBe(artRest({ fc: { cls: 1, kind: 'fcrc', places: 4 }, cc: null }));
    expect(artRest({ fc: null, cc: null })).toBeUndefined();
  });

  it('renders static marks (no animation), none on small simple thumbnails', () => {
    const full = renderToStaticMarkup(createElement(AircraftArt, { typeId: 'b77w', livery: LV, rest: { fc: 'fcrc', cc: 'ccrc' } }));
    expect(full.match(/data-rest="bunk"/g)?.length).toBe(4);
    expect(full).not.toMatch(/animate|transition/);
    const none = renderToStaticMarkup(createElement(AircraftArt, { typeId: 'b77w', livery: LV }));
    expect(none).not.toContain('data-rest');
    const thumb = renderToStaticMarkup(createElement(AircraftArt, { typeId: 'b77w', livery: LV, detail: 'simple', height: 20, rest: { fc: 'fcrc', cc: 'ccrc' } }));
    expect(thumb).not.toContain('data-rest');
  });
});
