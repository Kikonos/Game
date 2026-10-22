import { it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { DAY, monthKey, monthStart } from '../core/time';
import { refreshMarket } from '../ops/market';
it('scan', () => {
  const g = newGame(22);
  g.market.narrowIndex = 1.0;
  g.market.cycle = { phase: 'boom', since: g.now, until: g.now + 400 * DAY, narrowOff: 0.03, wideOff: -0.02 };
  for (let i = 1; i <= 12; i++) {
    g.now = monthStart(monthKey(g.now) + 1);
    refreshMarket(g);
    console.log(i, g.market.cycle.phase, g.market.narrowIndex, g.market.wideIndex);
  }
});
