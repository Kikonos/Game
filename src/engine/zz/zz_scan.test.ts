import { it } from 'vitest';
import { generateOffer } from '../contracts/offers';
import { newGame } from '../contracts/testkit';
it('scan', () => {
  const A = ['hajj', 'unRotation', 'vip', 'deportation', 'evacuation', 'medical', 'humanitarian', 'musicTour', 'antarctic', 'capacityLease', 'subcharterIn'] as const;
  for (const a of A) {
    let ok = 0; const t0 = performance.now();
    for (let s = 1; s <= 20; s++) {
      const g = newGame(s);
      g.company.standing = 2;
      const o = generateOffer(g, a, { wide: s % 2 === 0, window: false });
      if (o) ok++;
    }
    console.log(a, ok, Math.round(performance.now() - t0));
  }
}, 120000);
