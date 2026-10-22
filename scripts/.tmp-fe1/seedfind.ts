import { newGame, offer } from '../../src/engine/contracts/testkit';
import { feasibility } from '../../src/engine/contracts/feasibility';
import { DAY } from '../../src/engine/core/time';
for (let s = 195; s < 400; s++) {
  const g = newGame(s);
  let o; try { o = offer(g, 'aogCover'); } catch { continue; }
  const ac = Object.keys(g.fleet)[0];
  const c = feasibility(g, o.id, ac).checks.find((x) => x.id === 'crew');
  if (!c || c.level !== 'no' || !/^No crew can be at [A-Z]{3} for the first departure .*: the positioning crew would be on duty 13h/.test(c.label)) continue;
  o.start += DAY; if (o.pattern.kind === 'base') o.pattern.from += DAY; o.end += DAY;
  const c2 = feasibility(g, o.id, ac).checks.find((x) => x.id === 'crew');
  if (c2 && c2.level !== 'no') { console.log('seed', s, o.title); break; }
}
