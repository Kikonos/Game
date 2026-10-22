import { it } from 'vitest';
import { feasibilityAll } from '/home/user/wt/acmi/src/engine/contracts';
import { newGame, run } from '/home/user/wt/acmi/src/engine/contracts/testkit';
import { DAY } from '/home/user/wt/acmi/src/engine/core/time';
it('unfit', () => {
  for (const seed of [11, 13]) {
    const g = newGame(seed);
    const t0 = g.now;
    const seen = new Set<string>();
    for (let h = 1; h <= 60 * 24; h++) {
      run(g, t0 + h * 60);
      for (const o of Object.values(g.offers)) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        const rs = feasibilityAll(g, o.id);
        if (rs.some((r) => r.level !== 'no')) continue;
        const r = rs[0];
        console.log(seed, o.archetype, o.title, r ? r.checks.filter((c) => c.level === 'no').map((c) => `${c.id}: ${c.label}`).join(' | ') : 'none');
      }
    }
    void DAY;
  }
});
