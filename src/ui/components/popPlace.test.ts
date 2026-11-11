// v0.22 final check: on a phone held on its side a '?' note near the left edge opened under the camera island (the
// 59 px strip the game leaves empty), and one near the bottom ran into the home bar; upright, one near the top went
// under the status bar. The popover now keeps inside the safe area, on every device.

import { describe, expect, it } from 'vitest';
import { placePop, type Box } from './popPlace';

const rect = (left: number, top: number, w = 18, h = 18): Box => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
const POP = { width: 280, height: 187 };

describe('the popover keeps on the screen, inside the safe area, clear of the bug button', () => {
  it('iPad: under the anchor, centred on it', () => {
    const p = placePop(rect(600, 300), POP, 1180, 820, { l: 0, r: 0, t: 0, b: 20 });
    expect(p).toEqual({ left: 600 + 9 - 140, top: 326 });
  });

  it('a phone on its side: never in the 59 px strips left and right, nor in the home bar', () => {
    const safe = { l: 59, r: 59, t: 0, b: 21 };
    // The player's Crew › Planning "Crew set" word: anchor at x 172, the box used to start at 32.
    const a = placePop(rect(163, 215), POP, 852, 393, safe);
    expect(a.left).toBeGreaterThanOrEqual(59 + 8);
    expect(a.top).toBeGreaterThanOrEqual(8);
    expect(a.top + POP.height).toBeLessThanOrEqual(393 - 21 - 8);
    // Near the right edge.
    const b = placePop(rect(820, 100), POP, 852, 393, safe);
    expect(b.left + POP.width).toBeLessThanOrEqual(852 - 59 - 8);
    // An anchor low on the screen: the box goes above it, not into the home bar.
    const c = placePop(rect(400, 330), { width: 280, height: 137 }, 852, 393, safe);
    expect(c.top + 137).toBeLessThanOrEqual(330 - 8);
  });

  it('a note too tall for either side goes beside its anchor, not over it', () => {
    const safe = { l: 59, r: 59, t: 0, b: 21 };
    const tall = { width: 280, height: 210 };
    // The player's phone, Crew › Planning "How crew sets work": the '?' at 251–269 × 173–191.
    const anchor = rect(251, 173);
    const a = placePop(anchor, tall, 852, 393, safe);
    expect(a.left).toBe(anchor.right + 8);
    expect(a.top).toBeGreaterThanOrEqual(8);
    expect(a.top + tall.height).toBeLessThanOrEqual(393 - 21 - 8);
    // Near the right edge: to its left.
    const far = rect(700, 173);
    const b = placePop(far, tall, 852, 393, safe);
    expect(b.left + tall.width).toBe(far.left - 8);
    // No room on either side (a phone upright, the box nearly as wide as the screen): it stays where it was, on screen.
    const c = placePop(rect(180, 400), { width: 377, height: 800 }, 393, 852, { l: 0, r: 0, t: 59, b: 34 });
    expect(c.left).toBe(8);
  });

  it('a phone upright: not under the status bar; a tall note with no room either side stays whole on the screen', () => {
    const safe = { l: 0, r: 0, t: 59, b: 34 };
    const a = placePop(rect(300, 120), { width: 280, height: 420 }, 393, 852, safe);
    expect(a.top).toBe(146);
    const tall = { width: 280, height: 500 };
    const b = placePop(rect(300, 420), tall, 393, 852, safe);
    expect(b.top).toBeGreaterThanOrEqual(59 + 8);
    expect(b.top + tall.height).toBeLessThanOrEqual(852 - 34 - 8);
    expect(b.left + 280).toBeLessThanOrEqual(393 - 8);
    expect(b.left).toBeGreaterThanOrEqual(8);
  });

  it('the bug button: the box starts to its right, or above it when there is no room beside it', () => {
    const bug = rect(8, 778, 30, 30);
    const a = placePop(rect(20, 520), { width: 280, height: 230 }, 1180, 820, { l: 0, r: 0, t: 0, b: 20 }, bug);
    expect(a.top).toBe(546);
    expect(a.left).toBeGreaterThanOrEqual(bug.right + 8);
    // A phone upright: 393 wide, a 377 px box cannot sit beside the button, so it ends above it.
    const bugP = rect(8, 800, 30, 30);
    const b = placePop(rect(20, 540), { width: 377, height: 230 }, 393, 852, { l: 0, r: 0, t: 59, b: 34 }, bugP);
    expect(b.left).toBe(8);
    expect(b.top + 230).toBeLessThanOrEqual(bugP.top - 8);
  });

  it('with the button not measured, the corner zone is still kept clear', () => {
    const a = placePop(rect(10, 700), { width: 280, height: 100 }, 1180, 820);
    expect(a.left >= 48 || a.top + 100 <= 820 - 48).toBe(true);
  });
});
