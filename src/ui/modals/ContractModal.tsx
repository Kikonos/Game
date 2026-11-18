// v0.24 the signed contract, read back (Contracts › Active › a contract's sheet button): who, what, the terms it was
// signed on and how it stands. v0.25 the actions moved here from the card: the crew setting, sub-charter and cancel.

import { CalendarRange, ChevronDown, ChevronRight, CircleSlash, Handshake, Palette, Users } from 'lucide-react';
import { useState } from 'react';
import { cancelContract, cancelCost } from '../../engine/contracts';
import { fmtDay } from '../../engine/core/time';
import type { Contract, CrewExtra } from '../../engine/core/types';
import { crewExtraFor, extraCabinMax, setCrewExtra } from '../../engine/crew';
import { cancelWarning, lockOf } from '../../engine/scenario';
import { LockNote, lockedProps } from '../components/Locked';
import { Stepper, Toggle } from '../components/ui';
import { money } from '../format';
import { flag } from '../../data/countries';
import { clientStars } from '../../engine/contracts/prestige';
import { shapeOf } from '../../engine/contracts/shape';
import type { GameState } from '../../engine/core/types';
import { ClientStars } from '../components/ClientStars';
import { DurationStrip } from '../components/DurationStrip';
import { ShapeTags } from '../components/ShapeTags';
import { Modal } from '../components/ui';
import { ArchIcon, Chips, KV } from '../screens/common';
import { archLabel, offerDays, reqChips, routeSummary } from '../screens/screenLogic';
import { store, useGame } from '../store';
import { contractSheet } from './contractSheetLogic';
import { effectChips, Programme } from './OfferModal';

/** 'CS-TLI in Saudia colours' / 'Paint shop 3 May' for a contract with client paint. */
function paintLine(g: GameState, c: Contract): string {
  const client = g.clients[c.clientId]?.name ?? 'client';
  const painted = c.aircraftIds.filter((id) => g.fleet[id]?.paintedFor === c.id).map((id) => g.fleet[id].reg);
  if (painted.length) return `${painted.join(' + ')} in ${client} colours`;
  const m = Object.values(c.paint?.inMx ?? {}).map((id) => g.maintenance[id]).find((x) => x && (x.status === 'planned' || x.status === 'inWork'));
  return m ? `${c.paint!.kind === 'full' ? 'Repaint' : 'Decals'} in ${client} colours: paint shop ${m.at} ${fmtDay(m.start)}` : `${client} livery agreed`;
}

/** v0.6: this contract's extra crew (overrides the aircraft's); locked at the number the client pays for. */
export function ContractExtra({ g, c }: { g: GameState; c: Contract }) {
  const [open, setOpen] = useState(false);
  const eff = crewExtraFor(g, c.aircraftIds[0] ?? null, c.id);
  const min = Math.max(c.requirements.extraCabin, eff.paidMin);
  const set = (x: CrewExtra | null) => store.act((gg) => setCrewExtra(gg, { contractId: c.id }, x), { toastOk: false });
  const src = eff.paidMin ? `client pays for ${eff.paidMin}` : eff.source === 'client' ? 'client request' : eff.source === 'contract' ? 'set for this contract' : eff.source === 'aircraft' ? 'aircraft setting' : 'company default';
  const what = eff.cabin || eff.pilot ? [eff.cabin ? `+${eff.cabin} cabin` : '', eff.pilot ? 'spare pilot' : ''].filter(Boolean).join(' · ') : 'legal minimum';
  if (!open) {
    return (
      <button className="sc-extra-sum small" onClick={() => setOpen(true)} aria-expanded={false}>
        <Users className="sc-ico-s" /><span>Crew: <b>{what}</b></span><span className="dim">{src}</span><ChevronDown className="sc-ico-s dim" />
      </button>
    );
  }
  return (
    <div className="row gap-12 wrap sc-contract-extra">
      <span className="row gap-8"><span className="small">Extra cabin</span><Stepper value={eff.cabin} min={min} max={Math.max(min, extraCabinMax(g, c.aircraftIds[0] ?? null, c.requirements.extraCabin))} onChange={(v) => set({ cabin: v, pilot: eff.pilot })} format={(v) => `+${v}`} /></span>
      <span className="row gap-8"><span className="small">Spare pilot</span><Toggle on={!!eff.pilot} onChange={(v) => set({ cabin: eff.cabin, pilot: v ? 1 : 0 })} label="Spare pilot" /></span>
      <span className="tiny dim">{src}</span>
      {c.crewExtra && !eff.paidMin && <button className="btn btn-sm btn-ghost" onClick={() => set(null)}>Reset</button>}
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Done</button>
    </div>
  );
}

/** Asks before cancelling: the penalty and the money that goes back, apart. */
function confirmCancel(g: GameState, c: Contract) {
  const { penalty: pen, refund, total } = cancelCost(g, c.id);
  // v0.15 a scenario's own contract under a 'penalty' rule: cancelling it ends the scenario with no stars.
  const warn = cancelWarning(g, c.id);
  const cl = g.clients[c.clientId]?.name ?? 'The client';
  store.openModal({
    kind: 'confirm', danger: true, title: `Cancel ${c.title}?`, confirm: warn ? `Cancel, pay ${money(total)} and end the scenario` : `Cancel and pay ${money(total)}`,
    body: `${warn ? `${warn} ` : ''}Penalty ${money(pen)}${refund > 0 ? ` plus ${money(refund)} refunded for legs not flown` : ''}. All future flights are removed, reliability drops by 5 and ${cl} will remember it.`,
    onConfirm: () => store.act((gg) => cancelContract(gg, c.id)),
  });
}

const STATUS: Record<string, string> = { signed: 'Signed', active: 'Flying', completed: 'Completed', cancelled: 'Cancelled' };

export function ContractModal({ contractId }: { contractId: string }) {
  const g: GameState = useGame();
  const c = g.contracts[contractId];
  if (!c) return null;
  const cl = g.clients[c.clientId];
  const sheet = contractSheet(g, c);
  const regs = c.aircraftIds.map((id) => g.fleet[id]?.reg ?? '?').join(' + ');
  const days = offerDays(c);
  const close = () => store.closeModal();
  const open = c.status === 'signed' || c.status === 'active';
  // v0.15 the scenario's locks on this contract (cancel, hand-overs): the buttons stay, disabled, with the reason.
  const lockCancel = open ? lockOf(g, 'cancel', { contractId: c.id }) : null;
  const lockSub = open ? lockOf(g, 'subcharter') : null;
  return (
    <Modal size="wide" className="v24-contract" icon={<ArchIcon a={c.archetype} />} title={c.title} onClose={close} footer={
      <div className="row gap-8 v24-contract-foot">
        <button className="btn" onClick={() => { close(); store.navigate('schedule', { sel: { kind: 'aircraft', id: c.aircraftIds[0] }, view: String(Math.max(g.now, c.start)) }); }}><CalendarRange /> Schedule</button>
        {open && <button className={`btn ${lockSub ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'subcharter', contractId: c.id })} aria-label="Sub-charter legs to a rival" data-tip="Hand legs to a rival operator" {...lockedProps(lockSub)}><Handshake /> <span className="v25-hide-phone">Sub-charter</span></button>}
        {open && <button className={`btn btn-danger ${lockCancel ? 'locked' : ''}`} onClick={() => confirmCancel(g, c)} aria-label="Cancel contract" data-tip="Cancel the contract" {...lockedProps(lockCancel)}><CircleSlash /> <span className="v25-hide-phone">Cancel</span></button>}
        <span className="grow" />
        <button className="btn btn-primary" onClick={close}>Close</button>
      </div>
    }>
      <div className="col gap-12">
        <div className="row gap-8 wrap">
          <span className="upper dim">{archLabel(c)}</span>
          <span className={`badge ${c.status === 'active' ? 'good' : c.status === 'cancelled' ? 'bad' : ''}`}>{STATUS[c.status]}</span>
          <span className="small muted mono">{regs}</span>
        </div>
        <div className="row gap-8 wrap between">
          <span className="row gap-8"><b>{cl ? `${flag(cl.country)} ${cl.name}` : 'Client'}</b>{cl && <ClientStars n={clientStars(cl)} size={12} />}{c.broker && <span className="chip sc-chip sc-broker">via {c.broker}</span>}</span>
          {cl && !cl.own && <button className="btn btn-ghost btn-sm" onClick={() => store.openModal({ kind: 'client', clientId: cl.id })}>Client <ChevronRight /></button>}
        </div>
        <div className="upper dim">How it stands</div>
        <KV rows={sheet.status} />
        {c.paint?.accepted && open && <div className="small muted row gap-4"><Palette className="sc-ico-s" />{paintLine(g, c)}</div>}
        {(lockCancel || lockSub) && <LockNote why={lockCancel ?? lockSub} />}
        {open && c.product.kind !== 'dry' && <>
          <div className="upper dim">Crew</div>
          <ContractExtra g={g} c={c} />
        </>}
        <div className="of-shape-head">{routeSummary(c.pattern) && <span className="small muted mono">{routeSummary(c.pattern)}</span>}<ShapeTags s={shapeOf(c, (id) => g.fleet[id]?.typeId)} /></div>
        <DurationStrip now={g.now} first={days[0]} last={c.pattern.kind === 'base' ? days[1] : Math.max(c.start, c.end - 1)} className="of-dur" />
        <Chips chips={[...reqChips(c.requirements, c.pattern, { shape: true }), ...effectChips(c)]} />
        <div className="upper dim">Terms</div>
        <KV rows={sheet.terms} />
        {c.product.kind !== 'dry' && <>
          <div className="upper dim">Programme</div>
          <Programme o={c} />
        </>}
      </div>
    </Modal>
  );
}
