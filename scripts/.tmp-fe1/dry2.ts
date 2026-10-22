import { BAL } from '../../src/engine/core/balance';
import { createGame } from '../../src/engine/newGame';
import { devDryLease } from '../../src/engine/dev';
import { acceptOffer, feasibilityAll } from '../../src/engine/contracts';
import { advanceTo as adv0 } from '../../src/engine/sim';
const advanceTo = (g: any, t: number) => { for (let i = 0; i < 5000 && g.now < t && !g.gameOver; i++) adv0(g, t); };
import { DAY, fmtDay, fmtDateTime } from '../../src/engine/core/time';
(BAL.v08.dry as any).late = 1; (BAL.v08.dry as any).lateDays = [20, 20];
const step = Number(process.argv[2] ?? 0);
const g = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'DXB', seed: 1 });
const oid = devDryLease(g);
const rep = feasibilityAll(g, oid).find((r) => r.level !== 'no')!;
const res = acceptOffer(g, oid, [rep.aircraftId]);
const c = g.contracts[res.data!.contractId];
const ac = g.fleet[rep.aircraftId];
const dump = (w: string) => console.log(w, fmtDateTime(g.now), 'status', c.status, 'leasedAt', c.dry!.leasedAt && fmtDateTime(c.dry!.leasedAt), 'ac', ac.status, ac.at, 'flightId', ac.flightId,
  'out', c.dry!.outIds.map((id) => `${g.flights[id]?.from}-${g.flights[id]?.to} ${g.flights[id]?.status} ${g.flights[id] && fmtDateTime(g.flights[id].std)}`).join(','),
  'back', c.dry!.backIds.map((id) => `${g.flights[id]?.status} ${g.flights[id] && fmtDateTime(g.flights[id].std)}`).join(','));
dump('signed');
const end = c.end + 40 * DAY;
if (step) { for (let t = g.now; t < end; t += step * DAY) { advanceTo(g, t); } } else advanceTo(g, end);
dump('end');
const inv = g.finance.receivables.filter((r) => r.contractId === c.id);
for (const r of inv) console.log('   ', (r as any).desc, r.amount);
console.log('ledger leaseIncome invoiced', c.invoiced, 'late', c.dry!.late);
