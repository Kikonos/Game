import { newGame, offer, run } from '../../src/engine/contracts/testkit';
import { acceptOffer } from '../../src/engine/contracts';
import { changeRequestFor } from '../../src/engine/ops/events';
import { mghFor } from '../../src/engine/contracts/billing';
import { mghLabel } from '../../src/engine/contracts/pricing';
import { DAY, monthKey } from '../../src/engine/core/time';
for (const s of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const g = newGame(s);
  const o = offer(g, 'aogCover', { days: 9, start: g.now + 2 * DAY } as any);
  console.log(s, o.title, mghLabel(o.product, o.start, o.end, o.terms));
  const ac = Object.keys(g.fleet)[0];
  const r = acceptOffer(g, o.id, [ac]);
  if (!r.ok) { console.log('  no accept', r.error); continue; }
  const c = g.contracts[r.data!.contractId];
  run(g, c.start + DAY);
  console.log('  mghFor', mghFor(c, monthKey(g.now)).toFixed(1));
  if (changeRequestFor(g, c)) { const d = g.decisions[g.decisions.length - 1]; console.log('  ', d.body, '|', d.options[0].chips?.join(', '), '| default', d.defaultOption); break; }
}
