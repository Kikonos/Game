import { describe, expect, it } from 'vitest';
import { MAP_W, projection } from './mapData';
import { FRAME_SLACK, FRAME_STEP_U, frameFor, frameRot, frameX, landOffset, lonCentre, nearX, nextFrame } from './wrap';

const AP: Record<string, [number, number]> = { LIS: [-9.1, 38.8], MNL: [121, 14.5], AKL: [174.8, -37], LAX: [-118.4, 33.9], SYD: [151.2, -33.9], NAN: [177.4, -17.8] };

describe('v0.18 wrapping flat map', () => {
  it('a frame turns the projection so every longitude keeps its world x (one world width apart at most)', () => {
    for (const i of [-40, -15, -1, 0, 3, 18, 36, 71]) {
      const p = projection(frameRot(i));
      for (const [lon, lat] of Object.values(AP)) {
        const local = p([lon, lat])![0];
        expect(local).toBeGreaterThanOrEqual(-1e-6);
        expect(local).toBeLessThanOrEqual(MAP_W + 1e-6);
        const world = local + frameX(i);
        const base = projection(0)([lon, lat])![0];
        const n = (world - base) / MAP_W;
        expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
      }
    }
  });

  it('marks land in the copy nearest the middle of the view', () => {
    for (const cx of [-5200, -900, 0, 1000, 1999, 2600, 7400]) {
      const i = frameFor(cx);
      const p = projection(frameRot(i));
      for (const [lon, lat] of Object.values(AP)) {
        const world = p([lon, lat])![0] + frameX(i);
        expect(Math.abs(world - cx)).toBeLessThanOrEqual(MAP_W / 2 + FRAME_STEP_U);
      }
    }
  });

  it('the frame keeps still for small moves and steps on past its slack', () => {
    const i = frameFor(3000);
    const mid = frameX(i) + MAP_W / 2;
    expect(nextFrame(i, mid + FRAME_STEP_U * FRAME_SLACK * 0.9)).toBe(i);
    expect(nextFrame(i, mid - FRAME_STEP_U * FRAME_SLACK * 0.9)).toBe(i);
    expect(nextFrame(i, mid + FRAME_STEP_U * 3)).toBe(i + 3);
    expect(nextFrame(i, mid - FRAME_STEP_U * 2)).toBe(i - 2);
  });

  it('the land copy sits within half a world of the frame', () => {
    for (const f of [-4100, -999, 0, 450, 1001, 2900, 12345]) expect(Math.abs(landOffset(f) - f)).toBeLessThanOrEqual(MAP_W / 2);
  });

  it('nearX moves x by whole worlds only', () => {
    expect(nearX(100, 1900)).toBe(2100);
    expect(nearX(1900, 100)).toBe(-100);
    expect(nearX(700, 600)).toBe(700);
  });

  it('lonCentre frames a network the short way round', () => {
    expect(lonCentre([])).toBe(0);
    expect(lonCentre([10])).toBe(10);
    expect(lonCentre([-10, 30])).toBeCloseTo(10);
    // Auckland, Nadi, Los Angeles and Sydney: over the Pacific, not split across the map's edges.
    const c = lonCentre([AP.AKL[0], AP.NAN[0], AP.LAX[0], AP.SYD[0]]);
    expect(Math.abs(((c + 360) % 360) - 196.2)).toBeLessThan(0.5);
    // Lisbon and Manila: through Asia (130° apart that way), not over the Pacific.
    expect(lonCentre([AP.LIS[0], AP.MNL[0]])).toBeCloseTo((AP.LIS[0] + AP.MNL[0]) / 2);
  });
});
