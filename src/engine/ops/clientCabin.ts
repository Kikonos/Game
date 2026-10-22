// v0.7.4 client cabin requests (contracts/cabinTerms.ts): the quick reconfiguration before a contract starts (a
// 'refit' in our hangar with `clientCabin` set), the client's share invoiced when the work ends, and the change back
// after the contract (booked at the first free window, like the client paint strip).

import { BAL } from '../core/balance';
import { flightsOf, removeFlights, touchFlights } from '../core/entities';
import { invoice } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay } from '../core/time';
import type { Contract, GameState, MaintenanceEvent, Minute } from '../core/types';
import { cabinPresets } from '../../data/cabins';
import { cabinQuote, cabinTarget } from '../contracts/cabinTerms';
import { bookRefit, refitSlots, type RefitSlot } from './cabin';
import { usd } from './util';

/**
 * The window for a client's reconfiguration of `aircraftId` to `label`: the latest home-base window that ends
 * BAL.clientCabin.readyBefore before `before` (the first departure), looked for in the week before it first, else
 * null. Pure.
 */
export function clientCabinSlot(g: GameState, aircraftId: string, label: string, before: Minute): RefitSlot | null {
  const last = before - BAL.clientCabin.readyBefore;
  // Close to the start first (the aircraft keeps its own cabin for the work before), else the earliest windows.
  for (const after of [Math.max(g.now, last - 7 * DAY), g.now]) {
    const ok = refitSlots(g, aircraftId, label, 6, after).slots.filter((s) => s.ok && s.end <= last);
    if (ok.length) return ok[ok.length - 1];
  }
  return null;
}

/** Books a client reconfiguration ('in' to the client's layout, 'out' back to `label`); returns the error or null. */
export function bookClientCabin(g: GameState, c: Contract, aircraftId: string, phase: 'in' | 'out', label: string, start: Minute): string | null {
  const t = c.cabin;
  if (!t) return 'No cabin request';
  const r = bookRefit(g, aircraftId, label, g.company.homeBase, start);
  if (!r.ok) return r.error;
  const m = g.maintenance[r.data!.maintId];
  m.clientCabin = { contractId: c.id, phase };
  if (phase === 'in') (t.inMx ??= {})[aircraftId] = m.id;
  else (t.outMx ??= {})[aircraftId] = m.id;
  return null;
}

/** 'maint.end' of a client reconfiguration (cabin.ts onRefitEnd): the client's share invoiced (the 'out' only after a completed contract). */
export function onClientCabinEnd(g: GameState, m: MaintenanceEvent): void {
  const c = m.clientCabin ? g.contracts[m.clientCabin.contractId] : undefined;
  const ac = g.fleet[m.aircraftId];
  if (!c?.cabin || !ac || !m.clientCabin) return;
  const live = m.clientCabin.phase === 'in' ? c.status === 'signed' || c.status === 'active' : c.status === 'completed';
  const amount = live ? Math.round(m.cost * c.cabin.clientShare) : 0;
  const client = g.clients[c.clientId]?.name ?? 'The client';
  if (amount > 0) invoice(g, { clientId: c.clientId, contractId: c.id, desc: `Cabin ${m.clientCabin.phase === 'in' ? 'reconfiguration' : 'put back'}: ${ac.reg} (${c.title})`, amount, cat: 'otherRevenue', dueDays: c.payment.dueDays });
  pushMessage(g, {
    tone: 'good', cat: 'commercial', title: `${client} cabin: ${ac.reg} ${m.clientCabin.phase === 'in' ? `now ${m.refit?.cabin.label}` : 'back to its own cabin'}`,
    body: amount > 0 ? `${client} invoiced ${usd(amount)} (${Math.round(c.cabin.clientShare * 100)}% of ${usd(m.cost)}).` : `At our cost (${usd(m.cost)}).`,
    ref: { kind: 'contract', id: c.id },
  });
}

/** Contract cancelled by us: client reconfigurations not started are called off (one already done is put back by dailyClientCabin). */
export function cancelClientCabinFor(g: GameState, c: Contract): void {
  for (const id of Object.values(c.cabin?.inMx ?? {})) {
    const m = g.maintenance[id];
    if (!m || m.status !== 'planned') continue;
    m.status = 'cancelled';
    m.ev++;
    const ferries = (m.ferryIds ?? []).filter((f) => g.flights[f]?.status === 'scheduled');
    if (ferries.length) removeFlights(g, ferries);
    touchFlights(g);
  }
}

/**
 * Daily: after a finished or cancelled contract whose client cabin was fitted (and is to be put back, or the
 * contract was cancelled), the change back to the aircraft's own cabin at the first window within 30 days (warned
 * once when none).
 */
export function dailyClientCabin(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    const t = c.cabin;
    if (!t?.accepted || !t.from) continue;
    const done = c.status === 'completed' || c.status === 'cancelled';
    if (!done || (!t.revert && c.status === 'completed')) continue;
    for (const acId of c.aircraftIds) {
      const ac = g.fleet[acId];
      const from = t.from[acId];
      if (!ac || !from || ac.status === 'stored' || ac.status === 'leasedOut') continue;
      const target = cabinTarget(ac.typeId, t.layout);
      if (!target || ac.cabin.label !== target.label || from === ac.cabin.label) continue;
      const out = t.outMx?.[acId] ? g.maintenance[t.outMx[acId]] : undefined;
      if (out && (out.status === 'planned' || out.status === 'inWork' || out.status === 'done')) continue;
      // Another refit already booked (the player's, or the next client's) takes over.
      if (Object.values(g.maintenance).some((m) => m.aircraftId === acId && m.kind === 'refit' && (m.status === 'planned' || m.status === 'inWork'))) continue;
      if (!cabinPresets(ac.typeId).some((p) => p.label === from)) continue;
      let last = g.now;
      for (const f of flightsOf(g, acId)) if (f.contractId === c.id && (f.status === 'scheduled' || f.status === 'enroute')) last = Math.max(last, f.eta ?? f.sta);
      const slot = refitSlots(g, acId, from, 3, last).slots.find((s) => s.ok && s.start <= last + BAL.clientCabin.revertWithinDays * DAY);
      if (slot && !bookClientCabin(g, c, acId, 'out', from, slot.start)) continue;
      if (!t.warned) {
        t.warned = true;
        pushMessage(g, { tone: 'warn', cat: 'tech', title: `${ac.reg} still has ${g.clients[c.clientId]?.name ?? 'the client'}'s cabin`, body: `No free 2-day window in our hangar within ${BAL.clientCabin.revertWithinDays} days to put back ${from}; it flies as ${ac.cabin.label} until one opens.`, ref: { kind: 'aircraft', id: acId } });
      }
    }
  }
}

/** Sums for an offer's feasibility: per aircraft the reconfiguration, the change back and the client's share. Pure. */
export { cabinQuote };

/** 'Reconfiguration 12 Mar – 14 Mar' for the booked in-window. */
export const slotText = (s: RefitSlot) => `${fmtDay(s.start)} – ${fmtDay(s.end)}`;
