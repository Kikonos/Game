import { it } from 'vitest';
import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { DAY, fmtDateTime } from '../core/time';
it('dbg', () => {
  const g = createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 });
  for (let i = 0; i < 100000 && g.now < g.started + 30 * DAY; i++) advanceTo(g, g.started + 30 * DAY, new Set());
  for (const c of Object.values(g.contracts)) console.log('C', c.title, c.status, fmtDateTime(c.start), fmtDateTime(c.end));
  const fl = Object.values(g.flights).filter((f) => f.aircraftId);
  console.log('F', fl.length, JSON.stringify(fl.slice(0, 8).map((f) => [f.no, f.from, f.to, fmtDateTime(f.std), f.status, f.closedBy, f.delayReason])));
  for (const e of g.world?.events ?? []) console.log('E', e.title, fmtDateTime(e.start), fmtDateTime(e.end), e.closed);
  console.log(g.messages.slice(0, 15).map((m) => m.title).join(' | '));
});
