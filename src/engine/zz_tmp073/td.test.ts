import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { acceptOffer, feasibilityAll } from '../contracts';
import { resolveDecision } from '../ops';
import { DAY, fmtDateTime, monthKey } from '../core/time';
import { evalSegs } from '../crew/rules';
import { ctxOf, segsOf } from '../crew/timeline';
import type { GameState } from '../core/types';
function play(g: GameState): void {
  for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires).sort((a, b) => b.estValue - a.estValue || (a.id < b.id ? -1 : 1));
  for (const o of open.slice(0, 3)) {
    const r = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estMargin > 0);
    if (r && acceptOffer(g, o.id, [r.aircraftId]).ok) return;
  }
}
it('td', () => {
  const text = LZString.decompressFromBase64(readFileSync(new URL('../fixtures/save-v07.lz.txt', import.meta.url), 'utf8'))!;
  const g = deserialize(text);
  const end = g.now + 30 * DAY;
  while (g.now < end && !g.gameOver) { advanceTo(g, Math.min(end, g.now + 6 * 60), new Set()); play(g); }
  const c = g.crew['c5'];
  console.log(fmtDateTime(g.now), monthKey(g.now), JSON.stringify(c.twoDays));
  for (const s of segsOf(g, c)) console.log(s.kind, fmtDateTime(s.start), fmtDateTime(s.end), s.at, s.dutyId ?? '');
  console.log(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal'));
});
