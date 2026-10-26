import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibility, generateOffer } from '../../engine/contracts';
import { leased, legsOffer, newGame } from '../../engine/contracts/testkit';
import { DAY, HOUR, dayStart } from '../../engine/core/time';
import {
  axisTicks, blockText, chooseHits, dayPills, idleAt, idleGaps, paintLabel, pickBlocks, ppmOf, pressFlight, rowBlocks, textW, timelineSpan, visibleWindow, type GanttBlock,
} from './scheduleLogic';

const blk = (key: string, start: number, end: number, kind: GanttBlock['kind'] = 'flight', color: number | null = 0): GanttBlock => ({
  key, kind, start, end, color, label: key, refs: kind === 'idle' ? [] : [{ kind: 'flight', id: key }],
});

describe('idle gaps', () => {
  it('finds gaps of 12 h or more between busy spans, with the waiting airport', () => {
    const busy: [number, number, string][] = [[100, 200, 'OPO'], [200 + 13 * HOUR, 300 + 13 * HOUR, 'LIS'], [400 + 13 * HOUR, 500 + 13 * HOUR, 'FAO']];
    const gaps = idleGaps(busy, 0, 500 + 40 * HOUR, 'LIS');
    expect(gaps).toEqual([
      { from: 200, to: 200 + 13 * HOUR, at: 'OPO' },
      { from: 500 + 13 * HOUR, to: 500 + 40 * HOUR, at: 'FAO' },
    ]);
  });
  it('ignores short gaps and overlapping spans', () => {
    expect(idleGaps([[0, 100, 'A'], [50, 300, 'B'], [300 + 11 * HOUR, 400 + 11 * HOUR, 'C']], 0, 400 + 11 * HOUR)).toEqual([]);
  });
});

describe('tap picking', () => {
  const ppm = ppmOf(7); // 10 px per hour
  const blocks = [blk('a', 0, 60), blk('b', 6 * HOUR, 6 * HOUR + 60), blk('c', 6 * HOUR + 90, 6 * HOUR + 150), blk('idle', 10 * HOUR, 30 * HOUR, 'idle')];
  it('opens the nearest block within 44 px when blocks are narrower than a finger', () => {
    // 30 min after 'a' ends = 5 px away; 'b' is 45 px away, outside the slop.
    expect(chooseHits(pickBlocks(blocks, 90, ppm)).map((b) => b.key)).toEqual(['a']);
  });
  it('lists several blocks that share the slop, in time order', () => {
    expect(chooseHits(pickBlocks(blocks, 6 * HOUR + 75, ppm)).map((b) => b.key)).toEqual(['b', 'c']);
  });
  it('ignores taps further than 44 px and never picks idle gaps', () => {
    expect(pickBlocks(blocks, 20 * HOUR, ppm)).toEqual([]);
    expect(idleAt(blocks, 20 * HOUR)?.key).toBe('idle');
  });
  it('a tap squarely on a wide block opens only that block', () => {
    const wide = [blk('w', 0, 10 * HOUR), blk('n', 10 * HOUR + 30, 11 * HOUR)];
    expect(chooseHits(pickBlocks(wide, 5 * HOUR, ppm)).map((b) => b.key)).toEqual(['w']);
  });
});

describe('day pills (28 d)', () => {
  it("merges a day's legs into one pill with the dominant colour and keeps maintenance", () => {
    const d = 10 * DAY;
    const out = dayPills([blk('1', d + 60, d + 120, 'flight', 2), blk('2', d + 200, d + 300, 'flight', 2), blk('3', d + 400, d + 500, 'pos', 5), blk('m', d + DAY, d + DAY + 600, 'maint', null)]);
    expect(out.map((b) => b.kind)).toEqual(['pill', 'maint']);
    expect(out[0]).toMatchObject({ start: d + 60, end: d + 500, color: 2, label: '3 legs' });
    expect(out[0].refs).toHaveLength(3);
  });
});

describe('axis and window', () => {
  it('ticks every 3 h at 3 d, days only at 28 d', () => {
    const t0 = 100 * DAY;
    expect(axisTicks(t0, t0 + DAY, 3)).toHaveLength(5);
    const days = axisTicks(t0 + 5, t0 + 3 * DAY, 28);
    expect(days.every((t) => t.major)).toBe(true);
    expect(days).toHaveLength(3);
  });
  it('snaps the visible window to 6 h with 12 h of padding', () => {
    const ppm = ppmOf(7);
    const [a, b] = visibleWindow(1000, 900, 0, ppm);
    expect(a % (6 * HOUR)).toBe(0);
    expect(b % (6 * HOUR)).toBe(0);
    expect(a).toBeLessThanOrEqual(1000 / ppm - 12 * HOUR);
    expect(b).toBeGreaterThanOrEqual(1900 / ppm + 12 * HOUR);
    // A small scroll inside the same snap does not change the window (no re-render).
    expect(visibleWindow(1010, 900, 0, ppm)).toEqual([a, b]);
  });
});

describe('rows from a real game', () => {
  it('accepting an offer puts its flights on the aircraft row in the contract colour', () => {
    const g = newGame();
    const ac = leased(g);
    const t = dayStart(g.now) + 3 * DAY + 8 * HOUR;
    const o = legsOffer(g, [['LIS', 'OPO', t], ['OPO', 'LIS', t + 4 * HOUR]]);
    const res = acceptOffer(g, o.id, [ac.id]);
    expect(res.ok).toBe(true);
    const c = Object.values(g.contracts)[0];
    const [from, to] = timelineSpan(g);
    expect(from).toBeLessThan(g.now);
    expect(to).toBeGreaterThan(t);
    const blocks = rowBlocks(g, ac.id, from, to);
    const flights = blocks.filter((b) => b.kind === 'flight');
    expect(flights.length).toBeGreaterThanOrEqual(2);
    expect(flights.every((b) => b.color === c.color)).toBe(true);
    expect(flights[0].label).toMatch(/LIS-OPO/);
  });
  it('idle labels show the whole gap even when the window shows only a slice', () => {
    const g = newGame();
    const ac = leased(g);
    const t = dayStart(g.now) + 10 * DAY;
    const o = legsOffer(g, [['LIS', 'OPO', t], ['OPO', 'LIS', t + 4 * HOUR]]);
    acceptOffer(g, o.id, [ac.id]);
    const slice = rowBlocks(g, ac.id, g.now + DAY, g.now + 2 * DAY);
    const idle = slice.find((b) => b.kind === 'idle');
    expect(idle).toBeDefined();
    expect(idle!.start).toBe(g.now);
    expect(idle!.end).toBeGreaterThan(g.now + 9 * DAY);
  });
  it('v0.11 an idle gap stops at a sub-chartered leg instead of running under it', () => {
    const g = newGame();
    const ac = leased(g);
    const t = dayStart(g.now) + 10 * DAY;
    const o = legsOffer(g, [['LIS', 'OPO', t], ['OPO', 'LIS', t + 4 * HOUR]]);
    acceptOffer(g, o.id, [ac.id]);
    const rival = g.rivals[0];
    expect(rival).toBeDefined();
    for (const f of Object.values(g.flights)) if (f.contractId) f.operatedBy = rival.id;
    const blocks = rowBlocks(g, ac.id, g.now, g.now + 20 * DAY);
    const subs = blocks.filter((b) => b.kind === 'sub');
    expect(subs.length).toBeGreaterThanOrEqual(2);
    const idles = blocks.filter((b) => b.kind === 'idle');
    expect(idles.length).toBeGreaterThanOrEqual(2);
    for (const i of idles) for (const b of subs) expect(i.end <= b.start || i.start >= b.end).toBe(true);
    expect(idles[0].label).toMatch(/^idle /);
  });
});

describe('paint blocks (v0.5.1)', () => {
  it('draws a client paint-in as a hatched maintenance block in the client primary, labelled with the client', () => {
    const g = newGame(11);
    const o = generateOffer(g, 'seasonBase', { paint: { kind: 'decals', required: true }, wide: false, start: g.now + 30 * DAY, days: 60 });
    expect(o?.paint).toBeTruthy();
    const ac = Object.values(g.fleet).find((a) => feasibility(g, o!.id, a.id, { paint: true }).level !== 'no');
    expect(ac).toBeTruthy();
    expect(acceptOffer(g, o!.id, [ac!.id], { paint: true }).ok).toBe(true);
    const m = Object.values(g.maintenance).find((x) => x.kind === 'paint')!;
    const b = rowBlocks(g, ac!.id, m.start - DAY, m.end + DAY).find((x) => x.key === m.id)!;
    expect(b.kind).toBe('maint');
    expect(b.paint).toBe(o!.paint!.livery.primary);
    expect(b.label).toBe(`${paintLabel(g, m)} · ${m.at}`);
    expect(paintLabel(g, m)).toBe(`Paint · ${g.clients[o!.clientId].name}`);
  });
});

describe('v0.7 maintenance labels', () => {
  it('names refits and lease returns', async () => {
    const { maintLabel } = await import('./scheduleLogic');
    expect(maintLabel({ kind: 'refit', at: 'HAM', refit: { cabin: { label: '24J/90Y' } } } as never)).toEqual(['Refit → 24J/90Y · HAM', 'Refit']);
    expect(maintLabel({ kind: 'return', at: 'SNN' } as never)).toEqual(['Lease return SNN', 'Return']);
    expect(maintLabel({ kind: 'C', at: 'LIS' } as never)).toEqual(['C-check LIS', 'C']);
  });
});

describe('trip swap press (v0.7.2.1)', () => {
  it('a long press picks the flight under the finger, never maintenance or idle', () => {
    const g = newGame(3);
    const ac = leased(g);
    const t = g.now + 3 * DAY + 8 * HOUR;
    const o = legsOffer(g, [['LIS', 'DUS', t], ['DUS', 'LIS', t + 5 * HOUR]], 150);
    expect(acceptOffer(g, o.id, [ac.id]).ok).toBe(true);
    const ppm = ppmOf(7);
    const blocks = rowBlocks(g, ac.id, g.now, g.now + 10 * DAY);
    const legs = blocks.filter((b) => b.kind === 'flight');
    expect(pressFlight(g, blocks, legs[1].start + 30, ppm)).toBe(legs[1].key);
    expect(pressFlight(g, blocks, g.now + 8 * DAY, ppm)).toBeNull();
  });
});

describe('programme continues (v0.8)', () => {
  it('labels the gap past a base programme\'s generated days as the programme continuing, not idle', () => {
    const g = newGame(11);
    const o = generateOffer(g, 'seasonBase', { wide: false, start: g.now + 5 * DAY, days: 120 });
    expect(o).toBeTruthy();
    const ac = Object.values(g.fleet).find((a) => feasibility(g, o!.id, a.id).level !== 'no');
    expect(ac).toBeTruthy();
    expect(acceptOffer(g, o!.id, [ac!.id]).ok).toBe(true);
    const c = Object.values(g.contracts).find((k) => k.offerId === o!.id)!;
    expect(c.generatedUntil).toBeLessThan((c.pattern as { to: number }).to);
    const blocks = rowBlocks(g, ac!.id, g.now, c.end + 20 * DAY, { until: c.end + 20 * DAY });
    const cont = blocks.find((b) => b.kind === 'cont');
    expect(cont).toBeTruthy();
    expect(cont!.label).toMatch(/programme continues · flights added daily until/);
    expect(cont!.start).toBeGreaterThanOrEqual(c.generatedUntil - DAY);
    // Not tappable as a block (it is not an idle gap either).
    expect(pickBlocks(blocks, cont!.start + HOUR, ppmOf(7)).some((h) => h.block.kind === 'cont')).toBe(false);
  });
});

// v0.12 Visual B: block labels show only whole text, number over route when the full label does not fit.
describe('blockText', () => {
  const op = { kind: 'flight' as const, label: 'AWL145 LIS-PMI', short: 'PMI', no: 'AWL145', route: 'LIS-PMI', ftype: 'operating' as const };
  it('shows the full label when it fits, else number over route, else the number, else the short label', () => {
    expect(blockText(op, 200)).toEqual({ lines: ['AWL145 LIS-PMI'], tag: null });
    expect(blockText(op, 60).lines).toEqual(['AWL145', 'LIS-PMI']);
    expect(blockText(op, 45).lines).toEqual(['PMI']);
    expect(blockText({ ...op, kind: 'pos' }, 70).lines).toEqual(['AWL145']);
    expect(blockText(op, 42).lines.join()).not.toMatch(/…/);
    expect(blockText(op, 40).lines).toEqual(['PMI']);
    expect(blockText(op, 10).lines).toEqual([]);
  });
  it('never shows a label wider than its block', () => {
    for (let w = 0; w < 260; w += 3) {
      const t = blockText(op, w);
      for (const l of t.lines) expect(textW(l, t.lines.length === 2 ? 11 : 12)).toBeLessThanOrEqual(w);
    }
  });
  it('puts the FERRY and CREW SHORT tags in front only when everything fits', () => {
    const ferry = { ...op, kind: 'pos' as const, ftype: 'ferry' as const, label: 'Delivery SCL-LIS', no: 'Delivery', short: 'FERRY' };
    expect(blockText(ferry, 300).tag).toBe('ferry');
    expect(blockText(ferry, 120).tag).toBe(null);
    expect(blockText({ ...op, alert: 'red' }, 300).tag).toBe('short');
  });
  it('keeps the long one-line label of idle and maintenance blocks', () => {
    expect(blockText({ kind: 'idle', label: 'idle 15h' }, 80).lines).toEqual(['idle 15h']);
    expect(blockText({ kind: 'maint', label: 'C-check LIS', short: 'C' }, 30).lines).toEqual(['C']);
  });
});
