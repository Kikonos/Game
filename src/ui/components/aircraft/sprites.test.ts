// v0.10 raster sprites: every type has art, the assets exist and match the layout data, the paint stays inside
// the masks, and the livery stickers fit the measured fin and fuselage zone.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACMI_TYPES, ACMI_TYPES_LIST, artFor } from '../../../data/acmiTypes';
import { VARIANTS } from '../../../data/variants';
import type { Livery, TailStyle } from '../../../engine/core/types';
import { contrast, stickerGround, stickerInk } from './AircraftArt';
import { paintKey } from './compose';
import { fileOf, LENGTH_M, layoutOf, SPRITE_IDS } from './sprites';
import { SPRITE_DATA } from './sprites.gen';
import {
  boxCorners, defaultStickers, finInset, frameToView, hitBox, inPoly, MIN_VISIBLE, placeAt, sideAt, stickerLayout, titleBand, viewToFrame, visibleShare,
} from './stickers';

const PUB = resolve(__dirname, '../../../../public/aircraft');
const SCHEMES: TailStyle[] = ['solid', 'split', 'stripe', 'sweep'];
const lv = (tail: TailStyle, extra: Partial<Livery> = {}): Livery => ({ primary: '#1e4fd8', secondary: '#3ee6ff', tail, ...extra });
const IDS = SPRITE_IDS;

/** PNG IHDR size. */
function pngSize(f: string): [number, number] {
  const b = readFileSync(f);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
/** WebP canvas size (VP8X, VP8L or VP8). */
function webpSize(f: string): [number, number] {
  const b = readFileSync(f);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === 'VP8L') {
    const n = b.readUInt32LE(21);
    return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)];
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

describe('sprites and assets', () => {
  it('every ACMI type and airframe variant resolves to a sprite with its files', () => {
    const used = new Set<string>();
    for (const t of ACMI_TYPES_LIST) {
      used.add(artFor(t.id));
      for (const v of VARIANTS[t.id] ?? []) used.add(artFor(t.id, v.id));
    }
    for (const s of used) {
      expect(SPRITE_DATA[s], s).toBeDefined();
      const f = fileOf(s);
      for (const n of [`${f}-1024.webp`, `${f}-2048.webp`, `${f}-mask.png`]) expect(existsSync(resolve(PUB, n)), n).toBe(true);
    }
    // the A350-900ULR has its own art; the 777-200LR is gone (v0.10)
    expect(artFor('a35u')).toBe('a359ulr');
    expect(ACMI_TYPES.b77l).toBeUndefined();
    expect(artFor('a332', 'cf6pw')).toBe('a332-alt-engines');
    expect(artFor('b744', 'rr')).toBe('b744-alt-engines');
    expect(artFor('a321neo', 'classic')).toBe('a321neo-classic-doors');
  });

  it('asset sizes match the layout data; masks line up with the sprites (same frame, same aspect)', () => {
    for (const id of IDS) {
      const d = layoutOf(id), f = fileOf(id);
      expect(webpSize(resolve(PUB, `${f}-2048.webp`))).toEqual([d.w, d.h]);
      const [w1, h1] = webpSize(resolve(PUB, `${f}-1024.webp`));
      expect(w1).toBe(1024);
      expect(Math.abs(h1 - d.h / 2)).toBeLessThanOrEqual(1);
      // v0.10 the mask is as wide as the big asset (its body channel needs clean wing edges)
      const [mw, mh] = pngSize(resolve(PUB, `${f}-mask.png`));
      expect(mw).toBe(2048);
      expect(mh).toBe(d.h);
    }
  });

  it('layout data is sane: nose right of the tail, fin above the crown, zone inside the frame', () => {
    for (const id of IDS) {
      const d = layoutOf(id);
      expect(d.nose).toBeGreaterThan(d.tail + d.w * 0.8);
      expect(d.belly).toBeGreaterThan(d.crown);
      const finTop = Math.min(...d.fin.map((p) => p[1]));
      expect(finTop, id).toBeLessThan(d.crown);
      for (const [x, y] of [...d.fin, ...d.zone]) {
        expect(x >= 0 && x <= d.w && y >= 0 && y <= d.h, id).toBe(true);
      }
      expect(LENGTH_M[id], id).toBeGreaterThan(30);
    }
  });

  it('paint keys: a plain livery without stickers draws the sprite untouched; stickers and colours change the key', () => {
    const base = lv('solid');
    expect(paintKey({ ...base, plain: true })).toBeNull();
    const k0 = paintKey(base);
    expect(k0).not.toBeNull();
    const box = stickerLayout('a320ceo', base, { code: 'BH', name: 'Block Hours' })[0];
    expect(box).toBeDefined();
    expect(paintKey(base, [{ ...box, ink: '#ffffff' }])).not.toBe(k0);
    expect(paintKey(base, [{ ...box, ink: '#ffffff' }])).not.toBe(paintKey(base, [{ ...box, ink: '#000000' }]));
    expect(paintKey({ ...base, plain: true }, [{ ...box, ink: '#000000' }])).not.toBeNull();
  });
});

describe('tail code fit', () => {
  it('the auto code box lies inside the fin for every sprite, scheme, code and weight', () => {
    for (const id of IDS) {
      const fin = layoutOf(id).fin;
      for (const tail of SCHEMES) for (const code of ['AW', 'WW', 'XQZ']) for (const weight of [500, 700] as const) {
        const b = stickerLayout(id, lv(tail, { code: { weight } }), { code })[0];
        expect(b?.kind).toBe('code');
        expect(b.fontSize).toBeGreaterThan(0);
        for (const c of boxCorners(b)) expect(inPoly(fin, c), `${id} ${tail} ${code} ${weight}`).toBe(true);
      }
    }
  }, 30_000);

  it('finInset and the auto fin logo are inside the fin', () => {
    for (const id of IDS) {
      const fin = layoutOf(id).fin;
      for (const tail of SCHEMES) {
        const r = finInset(id, tail);
        expect(r.w * r.h).toBeGreaterThan(0);
        for (const c of boxCorners({ ...r, rot: 0 })) expect(inPoly(fin, c), `${id} ${tail}`).toBe(true);
      }
      const b = stickerLayout(id, lv('sweep', { logo: { id: 'globe', color: '#fff' } }), {})[0];
      expect(b.kind).toBe('logo');
      for (const c of boxCorners(b)) expect(inPoly(fin, c), id).toBe(true);
    }
  });
});

describe('titles', () => {
  it('sit inside the fuselage zone (clear of the wing and the engines) and start behind the nose', () => {
    for (const id of IDS) {
      const d = layoutOf(id), band = titleBand(id);
      for (const name of ['Block Hours', 'Transatlantic Wet Lease Partners']) {
        const b = stickerLayout(id, lv('solid'), { name }).find((x) => x.kind === 'titles')!;
        expect(b.w).toBeLessThanOrEqual(band.w + 1e-6);
        expect(b.cx + b.w / 2).toBeCloseTo(band.x, 6);
        expect(b.cy).toBeCloseTo(band.y, 6);
        for (const c of boxCorners(b)) expect(inPoly(d.zone, c), `${id} ${name}`).toBe(true);
      }
    }
  });

  it('are dropped at detail simple, fin code kept', () => {
    expect(stickerLayout('a320ceo', lv('solid'), { code: 'BH', name: 'Block Hours' }, 'simple').map((b) => b.kind)).toEqual(['code']);
  });

  it('defaultStickers reproduces the legacy layout; white draws nothing, plain keeps its stickers', () => {
    const a = lv('split');
    expect(stickerLayout('b763', { ...a, stickers: defaultStickers(a) }, { code: 'BH', name: 'X' })).toEqual(stickerLayout('b763', a, { code: 'BH', name: 'X' }));
    expect(stickerLayout('a320ceo', { ...lv('solid'), plain: true, stickers: [] }, { code: 'BH', name: 'X' })).toEqual([]);
    expect(stickerLayout('a320ceo', { ...lv('solid'), plain: true }, { code: 'BH', name: 'X' })).toHaveLength(2);
  });
});

describe('frames and coordinate mapping', () => {
  it('frameToView / viewToFrame round-trip on both sides', () => {
    for (const id of IDS) for (const side of ['fin', 'fuselage'] as const) {
      for (const [x, y] of [[0, 0], [1, 1], [0.3, 0.7], [0.85, 0.15], [0.5, 0.5]]) {
        const v = frameToView(id, side, x, y);
        const [x2, y2] = viewToFrame(id, side, v[0], v[1]);
        expect(Math.abs(x2 - x), `${id} ${side}`).toBeLessThan(1e-3);
        expect(Math.abs(y2 - y), `${id} ${side}`).toBeLessThan(1e-3);
      }
    }
  });

  it('nose is on the right, crown above belly, the fin leading edge faces the nose', () => {
    const nose = frameToView('a320ceo', 'fuselage', 0, 0.5), tail = frameToView('a320ceo', 'fuselage', 1, 0.5);
    expect(nose[0]).toBeGreaterThan(tail[0]);
    expect(frameToView('a320ceo', 'fuselage', 0.5, 0)[1]).toBeLessThan(frameToView('a320ceo', 'fuselage', 0.5, 1)[1]);
    expect(frameToView('a320ceo', 'fin', 0, 0.5)[0]).toBeGreaterThan(frameToView('a320ceo', 'fin', 1, 0.5)[0]);
  });

  it('sideAt: fin inset, title band, outside', () => {
    for (const id of IDS) {
      const r = finInset(id, 'solid');
      expect(sideAt(id, r.cx, r.cy), id).toBe('fin');
      const b = titleBand(id);
      expect(sideAt(id, b.x - 10, b.y), id).toBe('fuselage');
      expect(sideAt(id, b.x, 2), id).toBe(null);
      expect(sideAt(id, 2, b.y), id).toBe(null);
    }
  });

  it('placeAt switches side across the fin root and clamps to the frame', () => {
    const st = { id: 'code', kind: 'code' as const, side: 'fin' as const, scale: 1 };
    const b = titleBand('b77w');
    const p = placeAt('b77w', st, b.x - 40, b.y);
    expect(p.side).toBe('fuselage');
    const r = finInset('b77w', 'solid');
    expect(placeAt('b77w', p, r.cx, r.cy).side).toBe('fin');
    const out = placeAt('b77w', p, 4000, -100);
    expect(out.side).toBe('fuselage');
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('hitBox honours rotation and padding; scale and rotation are clamped', () => {
    const h = { cx: 0, cy: 0, w: 4, h: 1, rot: 90 };
    expect(hitBox(h, 0, 1.9)).toBe(true);
    expect(hitBox(h, 1.9, 0)).toBe(false);
    expect(hitBox(h, 0.7, 0, 0.3)).toBe(true);
    const b = stickerLayout('a320ceo', lv('solid', { stickers: [{ id: 'code', kind: 'code', side: 'fin', scale: 9, rotation: 200 }] }), { code: 'BH' })[0];
    const a = stickerLayout('a320ceo', lv('solid'), { code: 'BH' })[0];
    expect(b.fontSize! / a.fontSize!).toBeCloseTo(3, 6);
    expect(b.rot).toBe(45);
  });
});

describe('auto lettering reads on the paint under it', () => {
  const PAIRS: [string, string][] = [['#1e4fd8', '#3ee6ff'], ['#0b1f4d', '#f5c451'], ['#7a1030', '#f0b400'], ['#ffffff', '#0b1f4d'], ['#1a7a3a', '#ffffff']];
  it('the auto fin code is at least 3:1 against its ground for every sprite, scheme and colour pair', () => {
    for (const id of IDS) for (const tail of SCHEMES) for (const [primary, secondary] of PAIRS) {
      const l = lv(tail, { primary, secondary });
      const b = stickerLayout(id, l, { code: 'XQZ' }).find((x) => x.kind === 'code')!;
      expect(contrast(stickerInk(id, l, b), stickerGround(l, 'fin', { typeId: id, box: b })), `${id} ${tail} ${primary}/${secondary}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('titles on the white fuselage use the primary when it reads on white', () => {
    const l = lv('sweep', { primary: '#0b1f4d', secondary: '#f5c451' });
    const w = stickerLayout('a320ceo', l, { name: 'Atlantica Wings' }).find((x) => x.kind === 'titles')!;
    expect(stickerInk('a320ceo', l, w)).toBe('#0b1f4d');
    expect(stickerGround(l, 'fuselage', { typeId: 'a320ceo', box: w })).toBe('#ffffff');
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
  }, 90_000);
});
