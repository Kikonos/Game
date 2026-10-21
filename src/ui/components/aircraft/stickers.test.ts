import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Livery, TailStyle } from '../../../engine/core/types';
import { artGeometry, contrast, stickerGround, stickerInk } from './AircraftArt';
import { pathPoly } from './geometry';
import { PROFILE_BY_ID } from './specs';
import {
  boxCorners, defaultStickers, finInset, frameToView, hitBox, inPoly, MIN_VISIBLE, placeAt, sideAt, stickerLayout, viewToFrame, visibleShare,
} from './stickers';
import { TRACED } from './traced/load';

const IDS = [...new Set([...Object.keys(PROFILE_BY_ID), ...TRACED.keys()])].sort();
const SCHEMES: TailStyle[] = ['solid', 'split', 'stripe', 'sweep'];
const lv = (tail: TailStyle, extra: Partial<Livery> = {}): Livery => ({ primary: '#1e4fd8', secondary: '#3ee6ff', tail, ...extra });
const world = (p: readonly [number, number]): [number, number] => [-p[0], -p[1]];

describe('airframe outlines (approved art)', () => {
  // v0.5.2: traced crown / belly / tail cone faired (fair.ts, bounds in fair.test.ts); fin root follows;
  // constant-section crown held straight over the cabin span (round 1 fix)
  it('fuselage, fin, windows and engine cowls are byte-identical to the approved v0.5.2 art', () => {
    const h = createHash('sha1');
    for (const id of IDS) {
      const g = artGeometry(id);
      h.update([g.fus, g.fin.fill, g.windows, ...g.engines.map((e) => e.cowl)].join('|'));
    }
    expect(h.digest('hex')).toBe('859079ec6c99001109558a50cc5161500516654b');
  });

  it('fin.poly is the closed fill outline', () => {
    for (const id of IDS) {
      const g = artGeometry(id);
      expect(g.fin.poly.length).toBeGreaterThan(10);
      expect(g.fin.poly).toEqual(pathPoly(g.fin.fill));
    }
  });
});

describe('tail code fit (bug 1: letters floating off the fin)', () => {
  it('the auto code box lies inside the fin outline for every type, scheme, code and weight', () => {
    let n = 0;
    for (const id of IDS) {
      const poly = artGeometry(id).fin.poly;
      for (const tail of SCHEMES) {
        for (const code of ['AW', 'WW', 'MQ', '88', 'XQZ']) {
          for (const weight of [500, 700] as const) {
            const b = stickerLayout(id, lv(tail, { code: { weight } }), { code })[0];
            expect(b?.kind).toBe('code');
            expect(b.fontSize).toBeGreaterThan(0);
            for (const c of boxCorners(b)) expect(inPoly(poly, world(c)), `${id} ${tail} ${code} ${weight}`).toBe(true);
            n++;
          }
        }
      }
    }
    expect(n).toBe(IDS.length * 40);
  });

  it('finInset is inside the fin', () => {
    for (const id of IDS) {
      const poly = artGeometry(id).fin.poly;
      for (const tail of SCHEMES) {
        const r = finInset(id, tail);
        expect(r.w * r.h).toBeGreaterThan(0);
        for (const c of boxCorners({ ...r, rot: 0 })) expect(inPoly(poly, world(c)), `${id} ${tail}`).toBe(true);
      }
    }
  });

  it('a fin logo at auto size is inside the fin', () => {
    for (const id of IDS) {
      const poly = artGeometry(id).fin.poly;
      const b = stickerLayout(id, lv('sweep', { logo: { id: 'globe', color: '#fff' } }), {})[0];
      expect(b.kind).toBe('logo');
      for (const c of boxCorners(b)) expect(inPoly(poly, world(c)), id).toBe(true);
    }
  });
});

describe('titles', () => {
  it('fit inside the title band (length and nose-side start) on every type', () => {
    for (const id of IDS) {
      const g = artGeometry(id);
      for (const name of ['Block Hours', 'Transatlantic Wet Lease Partners']) {
        const b = stickerLayout(id, lv('solid'), { name }).find((x) => x.kind === 'titles')!;
        expect(b.w).toBeLessThanOrEqual(g.titles.w + 1e-6);
        expect(b.fontSize).toBeLessThanOrEqual(g.titles.size + 1e-9);
        // nose-side end of the ink at the band start, centred on the band line (v0.5 anchor)
        expect(b.cx + b.w / 2).toBeCloseTo(-g.titles.x, 6);
        expect(b.cy).toBeCloseTo(-g.titles.y, 6);
      }
    }
  });

  it('are dropped at detail simple, fin code kept', () => {
    const k = stickerLayout('a320ceo', lv('solid'), { code: 'BH', name: 'Block Hours' }, 'simple').map((b) => b.kind);
    expect(k).toEqual(['code']);
  });
});

describe('legacy liveries', () => {
  it('no stickers = code on the fin at the scheme anchor height, titles on the band', () => {
    for (const id of ['a320ceo', 'b738', 'b77w', 'atr72', 'concorde']) {
      for (const tail of SCHEMES) {
        const g = artGeometry(id);
        const [code, titles] = stickerLayout(id, lv(tail), { code: 'BH', name: 'Block Hours' });
        expect(code.kind).toBe('code');
        expect(code.side).toBe('fin');
        // same anchor line as v0.5 (or within 12 % of the fin when that gives clearly bigger letters,
        // up to ~24 % to step off the scheme's colour divide, e.g. the 737 split)
        expect(Math.abs(code.cy - -g.livery(tail).code.y), `${id} ${tail}`).toBeLessThanOrEqual((g.fin.top - g.H / 2) * 0.25);
        expect(titles.kind).toBe('titles');
        expect(titles.cy).toBeCloseTo(-g.titles.y, 6);
      }
    }
  });

  it('defaultStickers reproduces the legacy layout', () => {
    const a = lv('split');
    expect(stickerLayout('b763', { ...a, stickers: defaultStickers(a) }, { code: 'BH', name: 'X' })).toEqual(stickerLayout('b763', a, { code: 'BH', name: 'X' }));
  });

  it('a white livery draws nothing; plain keeps its stickers', () => {
    expect(stickerLayout('a320ceo', { ...lv('solid'), plain: true, stickers: [] }, { code: 'BH', name: 'X' })).toEqual([]);
    expect(stickerLayout('a320ceo', { ...lv('solid'), plain: true }, { code: 'BH', name: 'X' })).toHaveLength(2);
  });
});

describe('frames and coordinate mapping (mirrored art)', () => {
  it('frameToView / viewToFrame round-trip on both sides', () => {
    for (const id of IDS) {
      for (const side of ['fin', 'fuselage'] as const) {
        for (const [x, y] of [[0, 0], [1, 1], [0.3, 0.7], [0.85, 0.15], [0.5, 0.5]]) {
          const v = frameToView(id, side, x, y);
          const [x2, y2] = viewToFrame(id, side, v[0], v[1]);
          expect(Math.abs(x2 - x), `${id} ${side}`).toBeLessThan(1e-3);
          expect(Math.abs(y2 - y), `${id} ${side}`).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('nose is on the right: fuselage x = 0 maps right of x = 1, crown above belly', () => {
    const nose = frameToView('a320ceo', 'fuselage', 0, 0.5), tail = frameToView('a320ceo', 'fuselage', 1, 0.5);
    expect(nose[0]).toBeGreaterThan(tail[0]);
    expect(frameToView('a320ceo', 'fuselage', 0.5, 0)[1]).toBeLessThan(frameToView('a320ceo', 'fuselage', 0.5, 1)[1]);
    // fin leading edge (s = 0) faces the nose (right of the trailing edge)
    expect(frameToView('a320ceo', 'fin', 0, 0.5)[0]).toBeGreaterThan(frameToView('a320ceo', 'fin', 1, 0.5)[0]);
  });

  it('sideAt: fin centre, mid-fuselage, outside', () => {
    for (const id of IDS) {
      const r = finInset(id, 'solid');
      expect(sideAt(id, r.cx, r.cy), id).toBe('fin');
      const g = artGeometry(id);
      const m = frameToView(id, 'fuselage', 0.3, 0.3);
      expect(sideAt(id, m[0], m[1]), id).toBe('fuselage');
      expect(sideAt(id, m[0], -(g.box.y1 + 5)), id).toBe(null);
      expect(sideAt(id, 5, m[1]), id).toBe(null);
    }
  });

  it('placeAt switches side across the fin root and clamps to the frame', () => {
    const st = { id: 'code', kind: 'code' as const, side: 'fin' as const, scale: 1 };
    const m = frameToView('b77w', 'fuselage', 0.4, 0.35);
    const p = placeAt('b77w', st, m[0], m[1]);
    expect(p.side).toBe('fuselage');
    expect(p.x).toBeCloseTo(0.4, 3);
    expect(p.y).toBeCloseTo(0.35, 3);
    const r = finInset('b77w', 'solid');
    expect(placeAt('b77w', p, r.cx, r.cy).side).toBe('fin');
    const out = placeAt('b77w', p, 50, -100);
    expect(out.side).toBe('fuselage');
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('a placed sticker is drawn where it was dropped', () => {
    const st = placeAt('a359', { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 }, ...frameToView('a359', 'fuselage', 0.6, 0.4));
    const b = stickerLayout('a359', lv('solid', { stickers: [st] }), { name: 'Block Hours' })[0];
    const v = frameToView('a359', 'fuselage', 0.6, 0.4);
    expect(b.cx).toBeCloseTo(v[0], 2);
    expect(b.cy).toBeCloseTo(v[1], 2);
  });

  it('hitBox honours rotation and padding', () => {
    const b = { cx: 0, cy: 0, w: 4, h: 1, rot: 90 };
    expect(hitBox(b, 0, 1.9)).toBe(true);
    expect(hitBox(b, 1.9, 0)).toBe(false);
    expect(hitBox(b, 0.7, 0, 0.3)).toBe(true);
  });

  it('scale and rotation are clamped', () => {
    const b = stickerLayout('a320ceo', lv('solid', { stickers: [{ id: 'code', kind: 'code', side: 'fin', scale: 9, rotation: 200 }] }), { code: 'BH' })[0];
    const a = stickerLayout('a320ceo', lv('solid'), { code: 'BH' })[0];
    expect(b.fontSize! / a.fontSize!).toBeCloseTo(3, 6);
    expect(b.rot).toBe(45);
  });
});

describe('inPoly', () => {
  it('square', () => {
    const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(inPoly(sq, [0.5, 0.5])).toBe(true);
    expect(inPoly(sq, [1.5, 0.5])).toBe(false);
    expect(pathPoly('M0 0L2 0L2 -2Z')).toEqual([[0, -0], [2, -0], [2, 2]]);
  });
});

describe('auto lettering reads on the paint under it', () => {
  const PAIRS: [string, string][] = [['#1e4fd8', '#3ee6ff'], ['#0b1f4d', '#f5c451'], ['#7a1030', '#f0b400'], ['#ffffff', '#0b1f4d'], ['#1a7a3a', '#ffffff']];
  it('the auto fin code is at least 3:1 against its ground for every type, scheme and colour pair', () => {
    for (const id of IDS) for (const tail of SCHEMES) for (const [primary, secondary] of PAIRS) {
      const l = lv(tail, { primary, secondary });
      const b = stickerLayout(id, l, { code: 'XQZ' }).find((x) => x.kind === 'code')!;
      expect(contrast(stickerInk(id, l, b), stickerGround(l, 'fin', { typeId: id, box: b })), `${id} ${tail} ${primary}/${secondary}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('titles dragged onto the painted fuselage switch ink, and the warning ground is that paint', () => {
    const l = lv('sweep', { primary: '#0b1f4d', secondary: '#f5c451', stickers: [{ id: 'titles', kind: 'titles', side: 'fuselage', x: 0.85, y: 0.6, scale: 1 }] });
    const b = stickerLayout('a320ceo', l, { name: 'Atlantica Wings' })[0];
    expect(stickerGround(l, 'fuselage', { typeId: 'a320ceo', box: b })).toBe('#0b1f4d');
    expect(contrast(stickerInk('a320ceo', l, b), '#0b1f4d')).toBeGreaterThan(3);
    // on the white forward fuselage: primary, as v0.5
    const w = stickerLayout('a320ceo', lv('sweep', { primary: '#0b1f4d', secondary: '#f5c451' }), { name: 'Atlantica Wings' }).find((x) => x.kind === 'titles')!;
    expect(stickerInk('a320ceo', lv('sweep', { primary: '#0b1f4d', secondary: '#f5c451' }), w)).toBe('#0b1f4d');
  });
});

describe('placed stickers never vanish', () => {
  it('a sticker saved at any frame extreme is drawn with at least MIN_VISIBLE of it on the airframe', () => {
    const ends = [[0, 0], [0, 1], [1, 0], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]];
    for (const id of IDS) for (const kind of ['code', 'titles', 'logo'] as const) for (const side of ['fin', 'fuselage'] as const) for (const [x, y] of ends) {
      const l = lv('solid', { logo: { id: 'arc', color: '#ffffff' }, stickers: [{ id: kind, kind, side, x, y, scale: 1 }] });
      const b = stickerLayout(id, l, { code: 'W7', name: 'Atlantica Wings' })[0];
      expect(visibleShare(id, b), `${id} ${kind} ${side} ${x},${y}`).toBeGreaterThanOrEqual(MIN_VISIBLE);
    }
  }, 30000);
});
