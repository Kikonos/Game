// v0.25 crew-shortage card wording (hunter save m42): 'Joseph Galea is busy on V73062 to Zakynthos until 2 Oct' named one
// leg of a five-week base tour; it reads 'busy on the Nantes tour until 2 Oct' now.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { otherTrip } from './check';
import { rootReason } from './reasons';

describe('the reason a crew member is busy', () => {
  it('names the base tour they are on, not one of its legs', () => {
    const g = deserialize(fixture('v0221-riyadh'));
    const tours = Object.values(g.pairings).filter((p) => p.tour && p.deploymentId && p.status !== 'done' && p.status !== 'broken');
    let hit: string | null = null;
    for (const p of tours) {
      for (const q of tours) {
        if (q === p || q.tour!.set === p.tour!.set) continue;
        const s = q.slots.find((x) => x.crewId && !x.guest && x.role === 'CC');
        if (!s) continue;
        const c = g.crew[s.crewId!];
        const other = otherTrip(g, c, p, p.start, p.end, false);
        if (!other?.tour) continue;
        const r = rootReason(g, [{ code: 'overlap', level: 'illegal', text: 'Overlaps another duty' }], c, p);
        hit = r?.text ?? null;
        break;
      }
      if (hit) break;
    }
    expect(hit).toMatch(/^busy on the Riyadh tour until \d+ \w{3} \d{4}$/);
  });
});

describe('a day just under its limit', () => {
  it("reads 'too close to the limit', not as a breach", async () => {
    const { placeBlock } = await import('./control');
    const g = deserialize(fixture('v0221-riyadh'));
    const near = placeBlock(g, ['Deadhead + duty FDP 12:35, within 30 min of 13:00 max; rest at NTE needed landing by 07:25'], g.now + 600);
    expect(near).toContain('(12:35, too close to the 13:00 limit)');
    const over = placeBlock(g, ['Deadhead + duty FDP 13:35 > 13:00 max; rest at NTE needed landing by 07:25'], g.now + 600);
    expect(over).toContain('(13:35, limit 13:00)');
  });
});
