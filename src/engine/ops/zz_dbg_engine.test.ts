import { it } from 'vitest';
import { DAY, fmtDateTime } from '../core/time';
import { newGame, run } from '../contracts/testkit';
import { acquireAircraft, deliveryQuote, deliveryStatus } from '.';
import { devMarketOffer } from './market';
import { devGrantApproval } from './company';
it('dbg', () => {
  const g = newGame(8); (globalThis as any).DBG = 1;
  const q = deliveryQuote(g, 'a320ceo', 'CGK', g.now + 10 * DAY);
  console.log(q.text, q.legs.map((l) => `${l.from}-${l.to} ${fmtDateTime(l.std)} ${l.block} ${l.nightStopAfter}`));
  for (const [t, s] of [['b763', 'NRT'], ['b763', 'YUL'], ['a388', 'KUL'], ['b77l', 'BOM'], ['b789', 'CHS'], ['a35u', 'SIN'], ['a321neo', 'HAM'], ['a343', 'JNB'], ['b772', 'NBO'], ['a320ceo', 'DEL']]) {
    const x = deliveryQuote(g, t, s, g.now);
    console.log(t, s, x.text, x.days, x.legs.map((l) => l.block).join(','));
  }
  g.company.cash = 50e6;
  devGrantApproval(g, 'widebody');
  const id = devMarketOffer(g, 'b763', { site: 'FRA' });
  const r = acquireAircraft(g, id);
  const acId = r.ok ? r.data!.aircraftId : '';
  const ac = g.fleet[acId];
  const f0 = g.flights[ac.delivery!.ferryIds[0]];
  for (let k = 0; k < 30; k++) { run(g, ac.deliveredAt + k * 180); console.log(fmtDateTime(g.now), fmtDateTime(f0.std), f0.delay, f0.delayReason, f0.crewHeld, f0.crewTries, f0.status, f0.dutyId, ac.delivery!.waitingSince); }
  console.log(deliveryStatus(g, acId), g.messages.filter((m) => /ferry|pilots|handed/i.test(m.title)).map((m) => m.title + ' | ' + m.body), g.finance.current.lines.airportFees);
  console.log(Object.values(g.flights).filter((f) => f.aircraftId === acId).map((f) => [f.id, f.kind, f.purpose, f.from, f.to, fmtDateTime(f.std), f.status, f.contractId]));
  console.log(ac.delivery!.ferryIds.map((f) => fmtDateTime(g.flights[f].std)));
});
