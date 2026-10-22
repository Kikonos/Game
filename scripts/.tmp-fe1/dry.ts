import { BAL } from '../../src/engine/core/balance';
import { createGame } from '../../src/engine/newGame';
import { devDryLease } from '../../src/engine/dev';
import { acceptOffer, cancelContract, feasibilityAll, cancelCost } from '../../src/engine/contracts';
import { advanceTo as adv0, settle } from '../../src/engine/sim';
import { DAY, fmtDay } from '../../src/engine/core/time';
import { dryLeaseOf } from '../../src/engine/ops/dryLease';

const advanceTo = (g: any, t: number) => { for (let i = 0; i < 5000 && g.now < t && !g.gameOver; i++) adv0(g, t); };
const mode = process.argv[2] ?? 'cancel'; if (mode === 'late') (BAL.v08.dry as any).late = 1;
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const g = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'DXB', seed });
  const oid = devDryLease(g);
  if (!oid) { console.log(seed, 'no offer'); continue; }
  const o = g.offers[oid];
  const rep = feasibilityAll(g, oid).find((r) => r.level !== 'no');
  if (!rep) { console.log(seed, 'no feasible ac', feasibilityAll(g, oid).map((r) => r.checks.filter((c) => c.level === 'no').map((c) => c.label).join('|'))); continue; }
  const res = acceptOffer(g, oid, [rep.aircraftId]);
  if (!res.ok) { console.log(seed, 'accept failed', res.error); continue; }
  const cid = res.data!.contractId;
  const c = g.contracts[cid];
  const ac = g.fleet[rep.aircraftId];
  console.log(seed, 'signed', c.title, fmtDay(c.start), '→', fmtDay(c.end), 'ac', ac.reg);
  if (mode === 'cancel') {
    // advance until leased
    let t = g.now;
    while (c.dry!.leasedAt === undefined && t < c.start + 5 * DAY) { t += DAY; advanceTo(g, t); }
    console.log('  leased?', c.dry!.leasedAt !== undefined, 'status', ac.status, 'at', ac.at, 'cancelCost', JSON.stringify(cancelCost(g, cid)));
    const cash0 = g.company.cash;
    const r = cancelContract(g, cid);
    settle(g);
    console.log('  cancel', r.ok, r.msg ?? r.error, 'cash Δ', Math.round(g.company.cash - cash0));
    advanceTo(g, g.now + 10 * DAY); { for (const m of g.messages.slice(0, 12)) console.log('   MSG', m.title, '|', (m.body ?? '').slice(0, 140)); const a1 = g.fleet[ac.id]; console.log('  +10d', fmtDay(g.now), a1.status, a1.at, c.status, Object.values(g.flights).filter((f) => f.contractId === cid).map((f) => f.from + '-' + f.to + ' ' + fmtDay(f.std) + ' ' + f.status + ' duty ' + f.dutyId + ' ' + JSON.stringify({c: f.closedBy, st: (f as any).statusReason, d: f.delayMin})).join('; ')); }
    const a2 = g.fleet[ac.id];
    console.log('  +400d: ac status', a2?.status, 'at', a2?.at, 'flights', Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.status === 'scheduled').length, 'dryLeaseOf', !!dryLeaseOf(g, ac.id), 'gameOver', g.gameOver);
    break;
  } else {
    // late billing: run to end, collect leaseIncome invoices
    advanceTo(g, c.end + 40 * DAY);
    const inv = g.finance.receivables.filter((r) => r.contractId === cid);
    console.log('  late', c.dry!.late, 'status', c.status, 'leaseEnd', fmtDay(c.dry!.leaseEnd ?? c.end));
    for (const r of inv) console.log('   ', (r as any).desc, r.amount);
    console.log('  invoiced', c.invoiced); break;
  }
}
