// v0.24 (the player: "an option to view the full contract in the Active tab to revisit contracts") the signed contract
// read back: the terms it was signed on (rates, guarantee, positioning, payment, penalties) and how it stands (legs flown
// and left, money so far, what cancelling would cost now). Pure: the read-only sheet (ContractModal.tsx) draws these.

import { cancelCost, contractProgress } from '../../engine/contracts';
import { mghFor } from '../../engine/contracts/billing';
import { dryLeaseView } from '../../engine/ops';
import { DAY, fmtDate, fmtDateTime, monthKey } from '../../engine/core/time';
import type { Contract, GameState } from '../../engine/core/types';
import { money } from '../format';
import { fuelLine, offerDays } from '../screens/screenLogic';

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const MONTH_DAYS = 30.44;

export interface ContractSheet {
  /** The terms it was signed on. */
  terms: [string, string][];
  /** How it stands today. */
  status: [string, string][];
}

/** 'In advance, net 7 days' etc., as the offer said it. */
function paymentLine(c: Contract): string {
  const p = c.payment;
  const arrears = c.product.kind === 'charter' ? 'Invoiced after the job' : 'Monthly in arrears';
  return `${p.basis === 'advance' ? 'In advance' : p.basis === 'arrears' ? arrears : 'Deposit and balances before the trips'}, net ${p.dueDays} days`;
}

export function contractSheet(g: GameState, c: Contract): ContractSheet {
  const terms: [string, string][] = [];
  const p = c.product;
  const days = (c.end - c.start) / DAY;
  if (p.kind === 'wet') {
    const per = c.aircraftIds.length > 1 ? ' per aircraft' : '';
    terms.push(['Rate', `${usd(p.ratePerBH)} per block hour`]);
    terms.push(['Minimum guarantee', days < 28 ? `≈ ${Math.round((p.mghPerMonth * days) / MONTH_DAYS)} BH for this job${per}` : `${p.mghPerMonth} BH / month${per}`]);
    terms.push(['Above MGH', `${Math.round(p.excessRate * 100)}% of the rate`], ['Short-cycle fee', usd(p.cycleFee)]);
    terms.push(['Positioning', p.positioningBillable ? 'Billable at the rate' : 'At our cost']);
  } else if (p.kind === 'charter') {
    terms.push(['Price', `${usd(p.price)} all-in${p.fuelAtCost ? ' plus fuel at cost' : ''}`]);
    if (c.payment.basis !== 'arrears' && p.depositPct > 0) terms.push(['Deposit', `${Math.round(p.depositPct * 100)}% on signing`]);
    if (c.payment.basis !== 'arrears') terms.push(['Balance', `${p.balanceDaysBefore} days before each trip`]);
    terms.push(['Positioning', 'In the price (at our cost)']);
  } else {
    terms.push(['Rent', `${usd(p.rentPerMonth)} / month`], ['Reserves', `${usd(p.reservesPerFH)} / FH`]);
  }
  terms.push(['Fuel', fuelLine(p)]);
  const [d0, d1] = offerDays(c);
  terms.push(['Dates', `${fmtDate(d0)} – ${fmtDate(d1)}${c.pattern.kind === 'base' ? ` (${c.pattern.base} local)` : ''}`]);
  terms.push(['Signed', fmtDate(c.signed)]);
  terms.push(['Payment', paymentLine(c)]);
  terms.push(['If we cancel', c.penalties.cancelScale.map(([d, f]) => `${d} d ${Math.round(f * 100)}%`).join(' · ') || '—']);
  if (c.penalties.perCancelledLeg) terms.push(['Per cancelled leg', usd(c.penalties.perCancelledLeg)]);
  if (c.penalties.perDelay) terms.push(['Per delay over 3 h', usd(c.penalties.perDelay)]);
  if (c.paint?.accepted) terms.push(['Livery', `${c.paint.kind === 'full' ? 'Full repaint' : 'Decals'} in their colours · ${c.paint.clientShare >= 1 ? 'they pay' : c.paint.clientShare > 0 ? `they pay ${Math.round(c.paint.clientShare * 100)}%` : 'we pay'}`]);
  if (c.cabin?.accepted) terms.push(['Their cabin', `${c.cabin.layout === 'two-class' ? 'Two-class' : 'All economy'} · ${c.cabin.clientShare >= 1 ? 'they pay' : 'they pay half'}${c.cabin.revert ? ' · put back after' : ''}`]);
  if (c.extraPaid && c.requirements.extraCabinPaid) terms.push(['Extra cabin crew', `+${c.requirements.extraCabinPaid.n}, paid by the client`]);
  else if (c.requirements.extraCabin) terms.push(['Extra cabin crew', `+${c.requirements.extraCabin} required`]);

  const status: [string, string][] = [];
  const open = c.status === 'signed' || c.status === 'active';
  const dry = p.kind === 'dry' ? dryLeaseView(g, c.id) : null;
  const pr = contractProgress(g, c.id);
  if (dry) {
    status.push(['Flown by them', `${dry.fhSoFar.toLocaleString('en-US')} FH${dry.fhExpected ? ` of about ${dry.fhExpected.toLocaleString('en-US')}` : ''}`]);
    status.push(['Invoiced', money(dry.income)]);
  } else {
    const left = Math.max(0, pr.legsTotal - pr.legsDone);
    status.push(['Legs', `${pr.legsDone} flown${open ? ` · ${left} left` : ''}`]);
    if (c.legsFlown) status.push(['On time', `${c.legsOnTime ?? 0} of ${c.legsFlown}`]);
    status.push([p.kind === 'charter' ? 'Earned so far' : 'Revenue so far', money(pr.revenueToDate)]);
    if (p.kind === 'charter') status.push(['Invoiced so far', `${money(c.invoiced ?? 0)} of ${money(p.price)}`]);
    // The month's guarantee only while it applies (a signed lease not yet started has none this month).
    const mgh = p.kind === 'wet' && open ? Math.round(mghFor(c, monthKey(g.now))) : 0;
    if (mgh > 0) status.push(['This month', `${pr.bhMonth.toFixed(0)} of ${mgh} BH guaranteed`]);
    const next = pr.nextFlightId ? g.flights[pr.nextFlightId] : undefined;
    if (next && open) status.push(['Next', `${next.no} ${next.from}→${next.to} · ${fmtDateTime(next.std)} UTC`]);
  }
  if (c.subLegs?.length) status.push(['Handed to rivals', `${c.subLegs.length} leg${c.subLegs.length === 1 ? '' : 's'}`]);
  if (open) status.push(['Cancel now', money(cancelCost(g, c.id).total)]);
  if (c.status === 'cancelled' && c.cancelledAt) status.push(['Cancelled', fmtDate(c.cancelledAt)]);
  return { terms, status };
}
