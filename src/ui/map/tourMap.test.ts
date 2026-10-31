// v0.12.1 world tours on screen: the offer panel's map cut away from every stop, the Ops Map's route line while a tour
// runs, and the Schedule's stays at a stop told as the tour (never 'idle').

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { acceptOffer } from '../../engine/contracts';
import { devWorldTour } from '../../engine/contracts/missions';
import { newGame, run } from '../../engine/contracts/testkit';
import { DAY } from '../../engine/core/time';
import { devAddType } from '../../engine/dev';
import { rowBlocks, tourStay } from '../screens/scheduleLogic';
import { tourRoutes } from './mapLogic';
import { tourCentre } from './TourMap';

function signedTour() {
  const g = newGame(3, 'LIS');
  const acId = devAddType(g, 'a333');
  g.company.approvals.push('etops120', 'etops180');
  g.company.standing = 2;
  const o = g.offers[devWorldTour(g)];
  const r = acceptOffer(g, o.id, [acId]);
  if (!r.ok) throw new Error(r.error);
  return { g, acId, k: g.contracts[r.data!.contractId] };
}

describe('v0.12.1 world tour screens', () => {
  it('the route map is cut where no stop is near the edge', () => {
    const codes = ['CDG', 'GIG', 'IGU', 'IPC', 'PPT', 'SYD', 'SAI', 'VDO', 'SKD'];
    const c = tourCentre(codes);
    const cut = c + 180;
    for (const code of codes) {
      const d = Math.abs((((AIRPORT_BY_CODE[code].lon - cut) % 360) + 540) % 360 - 180);
      expect(d).toBeGreaterThan(15);
    }
  });

  it('the Ops Map draws the tour from three days before it starts: every leg, flown ones solid', () => {
    const { g, k } = signedTour();
    expect(tourRoutes(g)).toEqual([]);
    run(g, k.start - 2 * DAY);
    const before = tourRoutes(g);
    expect(before.length).toBe(k.pattern.kind === 'legs' ? k.pattern.legs.length : -1);
    expect(before.every((r) => r.dashed)).toBe(true);
    run(g, k.start + 4 * DAY);
    const during = tourRoutes(g);
    expect(during[0].dashed).toBe(false);
    expect(during[during.length - 1].dashed).toBe(true);
  }, 30_000);

  it('the Schedule shows a stop as the tour ashore, not an idle gap', () => {
    const { g, acId, k } = signedTour();
    run(g, k.start + 2 * DAY);
    const blocks = rowBlocks(g, acId, g.now, g.now + 10 * DAY);
    const stays = blocks.filter((b) => b.key.startsWith('tour-'));
    expect(stays.length).toBeGreaterThan(0);
    expect(stays[0].label).toMatch(/nights? ashore · Around the world/);
    expect(blocks.some((b) => b.kind === 'idle' && b.start < k.end - DAY)).toBe(false);
    expect(tourStay(g, acId, k.end + 5 * DAY, k.end + 6 * DAY)).toBeNull();
  }, 30_000);
});
